# Homey

Use [Homey](https://www.athom.com/) together with [BroadLink devices](http://www.ibroadlink.com/).

# Supported Devices

* [A1](http://www.ibroadlink.com/a1/) - Environment Sensor
* [RM3 Mini](http://www.ibroadlink.com/rmMini3/) Black/Red
  * The RM3 Mini is a wifi to IR (infrared) device. It can learn IR commands and transmit them.
* RM4 Mini - IR
* RM4 Pro - IR + RF 
* [RM5+](https://www.ibroadlink.com/product_2) - IR
* [RM Pro](http://www.ibroadlink.com/rmPro)  - IR
* [RM Pro Plus](http://www.ibroadlink.com/rmPro+)   - IR + RF
* SP1  - Power socket switch
* SP2  - Power socket switch with nightlight and power meter
* SP3S - Power socket switch with meter
* MP1 - 4-way Power socket switch
* Hysen - thermostat.
  * This is an oem device, also available with other brandnames, such as [Beok](http://www.beok-controls.com/product.asp).
* Dooya - [motorized curtain](http://en.dooya.com/products_3.html)

Note that the new **RM Max** features native Matter support.

**Others might follow...**

# Debug and Error log

In the application settings, there are 2 flags to enable logging: Debug and Sentry.
* Debug logging dumps messages via the console log. This only works if the app is
  started in debug mode from a PC (using 'athom app run --remote')
* Sentry is currently disabled

# Reference

This app is based on the hard work of other people.

See:
* <https://github.com/mjg59/python-broadlink>
* <https://github.com/davorf/BlackBeanControl>
* <https://github.com/frankjoke/ioBroker.broadlink2>
* <https://github.com/lprhodes/homebridge-broadlink-rm/tree/master/helpers>
* <http://peter.windridge.org.uk/playing-with-cheap-iot-devices>  (hysen thermostat)

Protocol:
* <https://blog.ipsumdomus.com/broadlink-smart-home-devices-complete-protocol-hack-bc0b4b397af1>

# NodeJS modules

Requires the following NodeJS modules
* broadlink-ir-converter
* crc

# app.json

app.json is split in serveral files (driver.compose.json et all).
In order to create a full app.json, open a commandline (i.e. terminal):

 > cd com.broadlink
 > athom app validate

# Installation & Version

See <https://homey.app/en-us/app/com.broadlink/Broadlink/> for Changelog
