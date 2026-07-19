# BroadLink Protocol References

External reference material for the BroadLink LAN/cloud protocol, related tools, and example implementations.

## Protocol Documentation

| Resource | Description |
| --- | --- |
| [python-broadlink protocol.md](https://github.com/mjg59/python-broadlink/blob/master/protocol.md) | The classic protocol description from the python-broadlink project. |
| [broadlink-dissector — LAN protocol](https://github.com/stephanschuurman/broadlink-dissector/blob/master/lan-protocol/protocol.md) | Updated, expanded, and very detailed LAN protocol description. |
| [broadlink-dissector — Cloud protocol](https://github.com/stephanschuurman/broadlink-dissector/blob/master/cloud-protocol/protocol.md) | Description of the BroadLink cloud protocol. |

## Tools

- [python-broadlink](https://github.com/mjg59/python-broadlink/) — Best starting point: a Python library with a good [protocol description](https://github.com/mjg59/python-broadlink/blob/master/protocol.md).
- [broadlink-dissector](https://github.com/stephanschuurman/broadlink-dissector) — A new (and my own) Wireshark dissector for the BroadLink protocol, including detailed protocol documentation.
- [Sensus](https://pasthev.github.io/sensus/) — Online conversion and analysis tool for IR formats (Pronto hex, Broadlink hex, Tuya, …).
- [IrScrutinizer](https://github.com/bengtmartensson/IrScrutinizer) — Desktop Java tool for IR signal analysis and protocol recognition.

## Example Implementations

- [Home Assistant — broadlink component](https://github.com/home-assistant/core/tree/dev/homeassistant/components/broadlink)
- [shaarkys/com.broadlink](https://github.com/shaarkys/com.broadlink) — Homey BroadLink app fork.
- [Broadlink-e-control-db-dump](https://github.com/NightRang3r/Broadlink-e-control-db-dump/) — Dump IR codes from the e-Control app database.
- [broadlinkgo](https://github.com/rob121/broadlinkgo) — Go implementation.

## Other Resources

- [BroadLink app](https://apps.apple.com/nl/app/broadlink/id1450257910) — Official app in the Apple App Store.
- [rmartijnr.eu](http://rmartijnr.eu) — IR tools for macOS for GlobalCache devices.
    - [Global Caché IR Database](https://irdb.globalcache.com/Home/Database) — Large database of IR codes.
