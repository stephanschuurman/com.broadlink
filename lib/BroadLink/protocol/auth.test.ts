const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

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

const { AuthCommandPacket } = requireLocal('./auth-command', '.homeybuild/lib/BroadLink/protocol/auth-command.js');
const { AuthResponsePacket } = requireLocal('./auth-response', '.homeybuild/lib/BroadLink/protocol/auth-response.js');
const { BroadlinkEncryptedPacketBase } = requireLocal('./encrypted-packet-base', '.homeybuild/lib/BroadLink/protocol/encrypted-packet-base.js');
const { BroadlinkPacketBase } = requireLocal('./packet-base', '.homeybuild/lib/BroadLink/protocol/packet-base.js');

const HEADER_SIZE = 0x30;
const EXT_HEADER_SIZE = 0x08;

function decryptDefault(encrypted: Buffer): Buffer {
  const decipher = crypto.createDecipheriv(
    'aes-128-cbc',
    BroadlinkEncryptedPacketBase.DEFAULT_KEY,
    BroadlinkEncryptedPacketBase.DEFAULT_IV,
  );
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

describe('BroadlinkEncryptedPacketBase (via AuthCommandPacket)', () => {

  function makeCommand() {
    const p = new AuthCommandPacket('192.168.1.10', 50000, new Date(2026, 6, 19, 12, 0, 0));
    p.payload.deviceIdentifier = '0123456789abcdef';
    p.payload.clientName = 'Homey';
    p.payload.authBlob = Buffer.alloc(0x10, 0xaa);
    p.payload.metadata = '{"tcp":"example.ibroadlink.com"}';
    return p;
  }

  it('payload starts with the extended header (device ID at 0x00)', () => {
    const p = makeCommand();
    p.deviceId = 0x11223344;
    const buf = p.encodePayload();
    assert.equal(buf.readUInt32LE(0x00), 0x11223344);
  });

  it('extended header contains checksum of the *unencrypted* payload at 0x04', () => {
    const p = makeCommand();
    const buf = p.encodePayload();
    const plain = decryptDefault(buf.subarray(EXT_HEADER_SIZE));
    assert.equal(buf.readUInt16LE(0x04), BroadlinkPacketBase.calculateChecksum(plain));
  });

  it('encrypted payload length is a multiple of the AES block size (16)', () => {
    const p = makeCommand();
    const buf = p.encodePayload();
    assert.equal((buf.length - EXT_HEADER_SIZE) % 0x10, 0);
  });

  it('payload is actually encrypted (plaintext not visible on the wire)', () => {
    const p = makeCommand();
    const buf = p.encodePayload();
    assert.ok(!buf.includes(Buffer.from('Homey', 'ascii')));
  });

  it('decodePayload() validates the payload checksum', () => {
    const p = makeCommand();
    const decoded = new AuthCommandPacket();
    decoded.decodePayload(p.encodePayload());
    assert.equal(decoded.payloadChecksumValid, true);
  });

  it('decodePayload() flags a corrupted payload checksum', () => {
    const p = makeCommand();
    const buf = p.encodePayload();
    buf.writeUInt16LE(buf.readUInt16LE(0x04) ^ 0xffff, 0x04);
    const decoded = new AuthCommandPacket();
    decoded.decodePayload(buf);
    assert.equal(decoded.payloadChecksumValid, false);
  });
});

describe('AuthCommandPacket plaintext payload', () => {

  function makeCommand() {
    const p = new AuthCommandPacket();
    p.payload.deviceIdentifier = '861234567890123';
    p.payload.clientName = 'Homey Pro';
    p.payload.authBlob = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    p.payload.metadata = '{"companyid":"abc"}';
    return p;
  }

  it('writes the fixed fields at the documented offsets', () => {
    const plain = makeCommand().encodePlainPayload();
    assert.equal(plain.readUInt32LE(0x00), 0); // reserved
    assert.equal(plain.toString('ascii', 0x04, 0x04 + 15), '861234567890123');
    assert.equal(plain[0x1e], 0x01); // flag
    assert.equal(plain[0x2d], 0x01); // flag 2
    assert.equal(plain.toString('ascii', 0x30, 0x30 + 9), 'Homey Pro');
    assert.deepEqual(plain.subarray(0x54, 0x64), Buffer.from('00112233445566778899aabbccddeeff', 'hex'));
    assert.equal(plain.toString('utf-8', 0x64), '{"companyid":"abc"}');
  });

  it('client name is NULL-terminated within its 32-byte field', () => {
    const p = makeCommand();
    p.payload.clientName = 'x'.repeat(100);
    const plain = p.encodePlainPayload();
    assert.equal(plain[0x4f], 0x00); // last byte of the field stays a terminator
  });

  it('encode/decode roundtrip preserves the payload', () => {
    const original = makeCommand();
    const decoded = new AuthCommandPacket();
    decoded.decodePayload(original.encodePayload());
    assert.deepEqual(decoded.payload, original.payload);
  });
});

describe('AuthResponsePacket', () => {

  function makeResponse() {
    const p = new AuthResponsePacket('192.168.1.194', 80, new Date(2026, 6, 19, 12, 0, 0));
    p.payload.deviceId = 0x00000001;
    p.payload.sessionKey = Buffer.from('0f0e0d0c0b0a09080706050403020100', 'hex');
    return p;
  }

  it('plaintext payload is 0x20 bytes: device ID, session key, tail padding', () => {
    const plain = makeResponse().encodePlainPayload();
    assert.equal(plain.length, 0x20);
    assert.equal(plain.readUInt32LE(0x00), 0x00000001);
    assert.deepEqual(plain.subarray(0x04, 0x14), Buffer.from('0f0e0d0c0b0a09080706050403020100', 'hex'));
    assert.deepEqual(plain.subarray(0x14, 0x20), Buffer.alloc(0x0c)); // zeros
  });

  it('full packet roundtrip via AuthResponsePacket.from()', () => {
    const original = makeResponse();
    const decoded = AuthResponsePacket.from(original.encodePacket());
    assert.deepEqual(decoded.payload, original.payload);
    assert.equal(decoded.header.checksumValid, true);
    assert.equal(decoded.payloadChecksumValid, true);
  });

  it('exposes the session key via the sessionKey getter', () => {
    const decoded = AuthResponsePacket.from(makeResponse().encodePacket());
    assert.equal(decoded.sessionKey.toString('hex'), '0f0e0d0c0b0a09080706050403020100');
  });

  it('session key from the response decrypts a packet encrypted with it', () => {
    const decoded = AuthResponsePacket.from(makeResponse().encodePacket());

    const cmd = new AuthCommandPacket();
    cmd.key = decoded.sessionKey;
    cmd.deviceId = decoded.payload.deviceId;
    cmd.payload.clientName = 'Homey';
    const wire = cmd.encodePayload();

    const receiver = new AuthCommandPacket();
    receiver.key = decoded.sessionKey;
    receiver.decodePayload(wire);
    assert.equal(receiver.payload.clientName, 'Homey');
    assert.equal(receiver.payloadChecksumValid, true);
  });
});

describe('BroadlinkPacketBase error code (signed int16)', () => {

  it('roundtrips a negative error code', () => {
    const p = new AuthResponsePacket('192.168.1.194', 80, new Date(2026, 6, 19, 12, 0, 0));
    p.header.errorCode = -7; // Control key is expired
    const decoded = AuthResponsePacket.from(p.encodePacket());
    assert.equal(decoded.header.errorCode, -7);
  });
});
