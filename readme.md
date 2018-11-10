Almond+ Platform plugin for the amazing [Homebridge](https://github.com/nfarina/homebridge) project.

# Installation

1. Install homebridge using: `npm install -g homebridge`
2. Install this plugin using: `npm install -g swiss6th/homebridge-almond`
3. Update your configuration file. See the samples below.

# Configuration

This plugin uses the Almond+ [WebSocket API](https://wiki.securifi.com/index.php/Websockets_Documentation#Devicelist), so you need to be running at least R89 firmware.

Add this to your homebridge `config.json` (updating the host and password):

 ```javascript
    "platforms": [
        {
            "platform": "Almond",
            "name": "Almond Platform",
            "host":"10.10.10.254",
            "password": "frank"
        }
    ]
```

Optionally, you can skip certain devices by their Almond+ device ID, or request that a certain device be setup as a HomeKit Outlet rather than a Switch:

 ```javascript
    "platforms": [
        {
            "platform": "Almond",
            "name": "Almond Platform",
            "host":"10.10.10.254",
            "password": "frank",
            "devices": {
                "10": {
                    "skip": true
                },
                "37": {
                    "setupAs": "outlet"
                },
                "24": {
                    "skip": false,
                    "setupAs": "switch"
                }
            }
        }
    ]
```

Note that if you change the `"setupAs"` flag for a device at a later point, you'll have to first set `"skip"` to `true` and let Homebridge remove it. Then remove the `"skip"` flag and change your `"setupAs"` preference.

# Supported Sensors

Some devices from each of these categories are supported:

- Binary switches
- Lightbulbs
- Multilevel switches (as lightbulbs)
- Thermostats
- Garage door openers
- Continuous fan controllers
- Smoke detectors
- Contact sensors
- Almond Click buttons

Not all devices are supported in each category, as Almond+ doesn't always interpret devices of the same type in the same way. I can only add support for what I can test.

# Warnings

Not everything works perfectly. Since I am mainly tailoring this fork to my needs, I'll add more sensors as time (and expertise) permits. Feel free to fork again, or submit pull requests. Be kind, as I'm new at Git (and JavaScript, unfortunately). My preference is for modern ES6 syntax (classes, arrow functions, `const` & `let`, spread, etc.).

# Credits
- Pablo Poo, on whose fork this plugin is based
- Thomas Purchas, the original creator of the plugin
- Timon Reinhard, as Purchas based his Almond Client on Reinhard's [work](https://github.com/timonreinhard/wemo-client)
- The creators of the [WeMo homebridge platform](https://github.com/rudders/homebridge-platform-wemo), as this plugin was originally based on their work