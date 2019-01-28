Almond platform plugin for the amazing [Homebridge](https://github.com/nfarina/homebridge) project. Note that this is not maintained or endorsed by Securifi.

# Installation

1. Install Homebridge using `npm install -g homebridge`
2. Install this plugin using `npm install -g swiss6th/homebridge-almond`
3. Update your configuration file. See the samples below.

# Configuration

This plugin uses the Almond [WebSocket API](https://wiki.securifi.com/index.php/Websockets_Documentation#Devicelist), so you need to be running at least R89 firmware.

Add the following to your Homebridge `config.json`, updating the host and password.

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

Optionally, you can add certain flags per device to modify how it is set up:

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
        },
        "25": {
          "setupAs": "doorbell"
        },
        "28": {
          "hideBatteryInfo": true
        }
      }
    }
  ]
```

## `"skip"` Flag

Set the `"skip"` flag to `true` if you want to leave the device out of HomeKit. Skipping a previously added device will cause Homebridge to remove it upon restart.

## `"setupAs"` Flag

Certain Almond devices support the `"setupAs"` flag:

- Binary switches may be either `"switch"` (default) or `"outlet"`. Switches may be customized later through the Home app as switches, lights, or fans.
- Almond Click buttons may be either `"button"` (default) or `"doorbell"`. Buttons may be programmed with up to 3 different actions (for press, double-press, and long-press) but provide no notifications. Doorbells are not programmable but provide notifications (including images if placed in the same room as a HomeKit camera).

If not specified, the default type is used.

Note that if you change the `"setupAs"` flag for a device at a later point, you'll have to first set `"skip"` to `true` and let Homebridge remove it after a restart. Then remove the `"skip"` flag and change your `"setupAs"` preference. Restart again for the change to take effect.

## `"hideBatteryInfo"` Flag

Set the `"hideBatteryInfo"` flag to `true` if you don't want the battery percentage reported through HomeKit. This is helpful for devices that inaccurately report a constant battery percentage (like `0`). If you decide to change `"hideBatteryInfo"` at a later point, you'll have to first set `"skip"` to `true` and let Homebridge remove the device after a restart. Then remove the `"skip"` flag and change your `"hideBatteryInfo"` preference. Restart again for the change to take effect.

# Supported Sensors

Some devices from each of these categories are supported:

- Binary switches
- Multiswitches (2 binary switches in one device)
- Multilevel switches (as lightbulbs)
- Continuous fan controllers
- Lightbulbs
- Thermostats
- Garage door openers
- Door locks
- Smoke detectors
- Contact sensors
- Door sensors
- Motion sensors
- Almond Click buttons

Not all devices are supported in each category, as Almond doesn't always interpret devices of the same type in the same way. I can only add support for what I can test.

# Warnings

Not everything works perfectly—or even well. Since I am mainly tailoring this fork to my needs, I'll add more sensors as time (and expertise) permits. Feel free to fork again, or submit pull requests. Be kind, as I'm new at Git (and JavaScript, unfortunately). My preference is for modern ES6 syntax (classes, arrow functions, template literals, etc.).

Note that this effort is a near-complete rewrite of the plugin. As such, it requires my rewrite of the [Almond Client](https://github.com/swiss6th/almond-client). Previous versions of the client are not compatible. If you install `homebridge-almond` through `npm` as listed above, you'll automatically get the correct dependencies.

My test device is an Almond+. If you have a different model, such as Almond 2015, Almond 3, or Almond 3S, I have no way to know if the plugin will work for you. Submit an issue or pull request if you find a discrepancy.

# Known Limitations

- HomeKit has a limit of 100 accessories per bridge (Homebridge instance, in this case). I have not been able to test this limit, as I have less than half that number. If you have a lot of accessories, just be aware of this. The limit applies to the total number of accessories hosted by your Homebridge instance—not just those hosted by this plugin.
- Devices may respond slowly when using a slider control in the Home app. I don't know if it's possible to improve this behavior, as the Almond sends updates very slowly over the WebSocket, and I made a conscious choice to keep the HomeKit controls responsive. If you have some useful debounce logic, submit a pull request.
- Some dimmers and fan controllers may default to full power when first toggled on through HomeKit. This happens because these devices have only a SwitchMultilevel property and use a value of `0` to show an `off` state. When the plugin is first started and reads a value of `0`, it has no idea what the previous `on` value was and simply defaults to `100%`. Once the plugin sees a value other than `0`, that value is cached. This way, the next time the device is turned on, it will return to its previous level.
- For combination smoke/carbon-monoxide detectors, only the detection state is reported to HomeKit. Whether the detection is of smoke or of CO is not reported, as this information doesn't appear to be available through the Almond.
- Almond Click buttons currently don't report tamper state to HomeKit. HomeKit doesn't currently accept tamper state for programmable buttons.

# Tips

## Running on a Raspberry Pi

Easily install Homebridge on a Raspberry Pi using [oznu's preconfigured Docker container](https://github.com/oznu/docker-homebridge/wiki/Homebridge-on-Raspberry-Pi). This works on any model of Pi and takes care of the fiddly bits (installing an appropriate version of Node.js, setting up Homebridge as a service, etc.).

Once you get it up and running, log in to [oznu's handy Web interface](https://github.com/oznu/homebridge-config-ui-x) (e.g., at [homebridge.local:8080](http://homebridge.local:8080)), click the Docker icon in the top-right corner (the whale), and choose Terminal. There you can install `homebridge-almond` using `npm install swiss6th/homebridge-almond`. Do not install this plugin from the Plugins tab, as the Web interface doesn't seem to understand installing straight from GitHub.

Make sure your `config.json` is set up as detailed above. You can access it from the Config tab of the Web interface.

## Naming Devices

If you add a new device to your Almond while `homebridge-almond` is running, make sure to set a meaningful name before confirming the device. This name will be used to identify the device in the logs. As soon as you confirm the device, it will be added to HomeKit (assuming it's a supported device). You can rename the device through HomeKit, and you can rename the device through the Almond, but the device will only show up in the logs under its original name. "BinarySwitch #24" is a lot less helpful than "Desk Fan".

## Finding Device IDs

If you need to know which Almond device a given HomeKit accessory controls, 3D-Touch (or long-press) the accessory in the Home app. Hit the Settings button at the bottom right corner, and then scroll to the bottom of the panel that pops up. The accessory's Serial Number displays the Almond device name and ID.

# Credits
- Pablo Poo, on whose fork this plugin is based
- Thomas Purchas, the original creator of the plugin
- Timon Reinhard, as Purchas based his Almond Client on Reinhard's [work](https://github.com/timonreinhard/wemo-client)
- The creators of the [WeMo homebridge platform](https://github.com/rudders/homebridge-platform-wemo), as this plugin was originally based on their work