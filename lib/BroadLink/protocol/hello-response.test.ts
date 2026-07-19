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

const { HelloResponsePacket } = requireLocal('./hello-response', '.homeybuild/lib/BroadLink/protocol/hello-response.js');

const DEVICE_LOCK_STATUS_UNLOCKED = 0x00;
const DEVICE_LOCK_STATUS_LOCKED = 0x01;

function printBuf(buf: Buffer): void {
  const lines: string[] = ['offset  hex   dec'];
  for (let i = 0; i < buf.length; i++) {
    const hex = buf[i].toString(16).padStart(2, '0');
    const dec = buf[i].toString(10).padStart(3, ' ');
    lines.push(`0x${i.toString(16).padStart(2, '0')}    ${hex}    ${dec}`);
  }
  console.log(lines.join('\n'));
}

describe('HelloResponsePacket.encodePayload()', () => {

  function makePacket(overrides: Partial<{
    deviceId:         number;
    deviceType:       number;
    deviceIP:         string;
    deviceMacAddress: string;
    deviceName:       string;
    deviceLocked:     number;
  }> = {}) {
    const p = new HelloResponsePacket('192.168.1.194', 49878);
    Object.assign(p.payload, overrides);
    return p;
  }

  it('returns a Buffer', () => {
    const buf = makePacket().encodePayload();
    assert.ok(Buffer.isBuffer(buf));
  });

  it('writes deviceId (LE uint32) at offset 0', () => {
    const buf = makePacket({ deviceId: 0x661b9d1f }).encodePayload();
    assert.equal(buf.readUInt32LE(0), 0x661b9d1f);
  });

  it('writes deviceType (LE uint16) at offset 4', () => {
    const buf = makePacket({ deviceType: 0x1234 }).encodePayload();
    assert.equal(buf.readUInt16LE(4), 0x1234);
  });

  it('writes IP octets at offsets 6–9 (reversed byte order)', () => {
    const buf = makePacket({ deviceIP: '10.20.30.40' }).encodePayload();
    assert.deepEqual([...buf.subarray(6, 10)], [40, 30, 20, 10]);
  });

  it('writes MAC octets at offsets 0x0a–0x0f', () => {
    const buf = makePacket({ deviceMacAddress: 'aa:bb:cc:dd:ee:ff' }).encodePayload();
    assert.deepEqual([...buf.subarray(0x0a, 0x10)], [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
  });

  it('writes deviceName as UTF-8 at offset 0x10', () => {
    const buf = makePacket({ deviceName: 'Living Room' }).encodePayload();
    const name = buf.toString('utf-8', 0x10, 0x10 + 'Living Room'.length);
    assert.equal(name, 'Living Room');
  });

  it('buffer has correct size (0x50 bytes)', () => {
    const buf = makePacket({ deviceName: 'x'.repeat(100) }).encodePayload();
    assert.equal(buf.length, 0x50);
  });

  it('locked status is written at offset 0x4f (0x7f - 0x30)', () => {
    const buf = makePacket({ deviceLocked: DEVICE_LOCK_STATUS_LOCKED }).encodePayload();
    assert.equal(buf[0x4f], DEVICE_LOCK_STATUS_LOCKED);
  });

  it('encodePayload() and decodePayload() are consistent', () => {
    const original = makePacket({ 
      deviceId: 0x661b9d1f,
      deviceType: 0x1234,
      deviceIP: '192.168.1.101',
      deviceMacAddress: 'aa:bb:cc:dd:ee:ff',
      deviceName: 'Living Room',
      deviceLocked: DEVICE_LOCK_STATUS_UNLOCKED,
    });
    const buf = original.encodePayload();
    const decoded = new HelloResponsePacket();
    decoded.decodePayload(buf);
    assert.deepEqual(decoded.payload, original.payload);
  });
  
//   it('Print Test', () => {
//     const buf = makePacket({ 
//         deviceName: 'Living Room',
//         deviceId: 0x661b9d1f,
//         deviceType: 0x1234,
//         deviceIP: '192.168.1.194',
//         deviceMacAddress: 'aa:bb:cc:dd:ee:ff',
//         deviceLocked: DEVICE_LOCK_STATUS_UNLOCKED, 
//     }).encodePayload();
//     printBuf(buf);
//   });

});
