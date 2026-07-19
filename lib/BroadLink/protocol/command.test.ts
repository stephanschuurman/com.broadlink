const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function requireLocal(modulePath: string, builtJsFallback: string) {
  try {
    return require(modulePath);
  } catch (err: any) {
    if (err?.code === 'MODULE_NOT_FOUND') {
      return require(path.join(process.cwd(), builtJsFallback));
    }
    throw err;
  }
}

const { CommandRequestPacket } = requireLocal('./command-request', '.homeybuild/lib/BroadLink/protocol/command-request.js');
const { CommandResponsePacket } = requireLocal('./command-response', '.homeybuild/lib/BroadLink/protocol/command-response.js');

const RM_SEND_DATA = 0x02;
const RM_LEARN = 0x03;
const RM_CHECK = 0x04;

const SESSION_KEY = Buffer.from('0f0e0d0c0b0a09080706050403020100', 'hex');

describe('CommandRequestPacket plaintext payload', () => {

  it('writes inner length (data length + 4) at 0x00', () => {
    const p = CommandRequestPacket.sendData(Buffer.alloc(10));
    const plain = p.encodePlainPayload();
    assert.equal(plain.readUInt16LE(0x00), 14);
  });

  it('writes the command as LE uint32 at 0x02', () => {
    const p = CommandRequestPacket.sendData(Buffer.alloc(0));
    const plain = p.encodePlainPayload();
    assert.equal(plain.readUInt32LE(0x02), RM_SEND_DATA);
  });

  it('writes the data from 0x06', () => {
    const data = Buffer.from([0x26, 0x00, 0x02, 0x00, 0x12, 0x34]);
    const plain = CommandRequestPacket.sendData(data).encodePlainPayload();
    assert.deepEqual(plain.subarray(0x06), data);
  });

  it('enterLearning() has command Learn and no data', () => {
    const plain = CommandRequestPacket.enterLearning().encodePlainPayload();
    assert.equal(plain.readUInt16LE(0x00), 4);
    assert.equal(plain.readUInt32LE(0x02), RM_LEARN);
    assert.equal(plain.length, 6);
  });

  it('checkData() has command Check and no data', () => {
    const plain = CommandRequestPacket.checkData().encodePlainPayload();
    assert.equal(plain.readUInt32LE(0x02), RM_CHECK);
  });

  it('decodePlainPayload() strips the AES zero padding using the inner length', () => {
    const data = Buffer.from([0x26, 0x01, 0x02, 0x03, 0x04]);
    const original = CommandRequestPacket.sendData(data);
    original.key = SESSION_KEY;

    const decoded = new CommandRequestPacket();
    decoded.key = SESSION_KEY;
    decoded.decodePayload(original.encodePayload()); // wire payload is padded to 16 bytes
    assert.deepEqual(decoded.payload.data, data);    // …but decode returns exactly 5 bytes
    assert.equal(decoded.payload.command, RM_SEND_DATA);
  });
});

describe('CommandRequestPacket ↔ CommandResponsePacket roundtrip', () => {

  it('request encrypted with the session key decodes on the receiving side', () => {
    const request = CommandRequestPacket.sendData(Buffer.from('260088001234', 'hex'), '192.168.1.10', 50000);
    request.key = SESSION_KEY;
    request.deviceId = 0x01;

    const received = new CommandRequestPacket();
    received.key = SESSION_KEY;
    received.decodePacket(request.encodePacket());

    assert.equal(received.deviceId, 0x01);
    assert.equal(received.payload.command, RM_SEND_DATA);
    assert.deepEqual(received.payload.data, Buffer.from('260088001234', 'hex'));
    assert.equal(received.header.checksumValid, true);
    assert.equal(received.payloadChecksumValid, true);
  });

  it('response roundtrips via CommandResponsePacket.from() with a session key', () => {
    const response = new CommandResponsePacket('192.168.1.194', 80, new Date(2026, 6, 19, 12, 0, 0));
    response.key = SESSION_KEY;
    response.payload.command = RM_CHECK;
    response.payload.data = Buffer.from('2600020012341122', 'hex'); // captured IR code

    const decoded = CommandResponsePacket.from(response.encodePacket(), SESSION_KEY);
    assert.equal(decoded.payload.command, RM_CHECK);
    assert.deepEqual(decoded.payload.data, Buffer.from('2600020012341122', 'hex'));
    assert.equal(decoded.isSuccess, true);
  });

  it('isSuccess is false when the header carries a negative error code', () => {
    const response = new CommandResponsePacket();
    response.key = SESSION_KEY;
    response.header.errorCode = -4; // Command not supported

    const decoded = CommandResponsePacket.from(response.encodePacket(), SESSION_KEY);
    assert.equal(decoded.isSuccess, false);
    assert.equal(decoded.header.errorCode, -4);
  });
});
