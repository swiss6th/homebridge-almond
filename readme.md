Almond+ Platform plugin for the amazing [Homebridge](https://github.com/nfarina/homebridge) project.

# Installation

1. Install homebridge using: `npm install -g homebridge`
2. Install this plugin using: `npm install -g swiss6th/homebridge-almond`
3. Update your configuration file. See the sample below.

# Configuration

Configuration sample:

This uses the Almond+ [websocket API](https://wiki.securifi.com/index.php/Websockets_Documentation#Devicelist) so you need to be running at least R89 firmware.

Then add this to your homebridge config.json (updating the password).

 ```javascript
    "platforms": [
        {
            "platform": "Almond",
            "name": "Almond Platform",
            "host":"10.10.10.254",
            "port": "7681",
            "username": "root",
            "password": "frank"
        }
    ]
```

# Supported Sensors
- Binary switches
- Lightbulbs
- Contact sensors
- Smoke detectors
- Thermostats (mostly)

Not everything functions perfectly. More sensors will be added as time (and expertise) permits. 

# Credits
Credits to
- Pablo Poo, on whose fork this plugin is based
- Thomas Purchas, the original creator of the plugin
- Timon Reinhard, as Purchas based his Almond Client on Reinhard's [work](https://github.com/timonreinhard/wemo-client)
- The creators of the [WeMo homebridge platform](https://github.com/rudders/homebridge-platform-wemo), as this plugin is based on their work