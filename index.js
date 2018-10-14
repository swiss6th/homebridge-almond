"use strict";

var Almond = require('almond-client'),
	deviceTypes = require('almond-client/deviceTypes'),
	deviceProperties = require('almond-client/deviceProperties'),
	debug = require('debug')('homebridge-platform-almond');

var Accessory, Characteristic, Consumption, Service, TotalConsumption, UUIDGen;

module.exports = function(homebridge) {
	Accessory = homebridge.platformAccessory;
	Characteristic = homebridge.hap.Characteristic;
	Service = homebridge.hap.Service;
	UUIDGen = homebridge.hap.uuid;

	Consumption = function() {
		Characteristic.call(this, 'Consumption', 'E863F10D-079E-48FF-8F27-9C2605A29F52');

		this.setProps({
			format: Characteristic.Formats.UINT16,
			unit: 'W',
			perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
		});

		this.value = this.getDefaultValue();
	};
	require('util').inherits(Consumption, Characteristic);

	homebridge.registerPlatform("homebridge-almond", "Almond", AlmondPlatform, true);
}

function AlmondPlatform(log, config, api) {
	var platform = this;
	this.log = log;
	this.config = config;
	this.api = api;

	this.accessories = [];

	this.log("Starting up, config:", config);

	this.api.on('didFinishLaunching', function() {
		platform.client = new Almond(platform.config);

		platform.client.on("ready", function() {
			platform.client.getDevices().forEach(platform.addAccessory.bind(platform));
			platform._pruneAccessories();
		});
	});
}

AlmondPlatform.prototype.addAccessory = function(device) {
	var platform = this;
	var services = [];
	this.log("Got device. Name: %s, ID: %s, Type: %s", device.name, device.id, device.type)

	if (device.props === undefined) {
		this.log("Device not supported.");
		return;
	}

	switch (Number(device.type)) {
		case deviceTypes.MultilevelSwitch:
			this.log("+Service.Lightbulb (MultilevelSwitch)");
			services.push(Service.Lightbulb);
			break;
		case deviceTypes.MultilevelSwitchOnOff:
			this.log("+Service.Lightbulb");
			services.push(Service.Lightbulb);
			break;
		case deviceTypes.Thermostat:
			this.log("+Service.Thermostat");
			services.push(Service.Thermostat);
			break;
		case deviceTypes.ContactSwitch:
			this.log("+Service.ContactSensor");
			services.push(Service.ContactSensor);
			// ToDo: test for temperature sensor service
			break;
		case deviceTypes.FireSensor:
			this.log("+Service.SmokeSensor");
			services.push(Service.SmokeSensor);
			break;
		case deviceTypes.SmokeDetector:
			this.log("+Service.SmokeSensor");
			services.push(Service.SmokeSensor);
			break;
		case deviceTypes.GarageDoorOpener:
			this.log("+Service.GarageDoorOpener");
			services.push(Service.GarageDoorOpener);
			break;
		case deviceTypes.GenericPSM:
			if (device.manufacturer !== undefined && device.manufacturer == "GE" && device.model !== undefined && device.model == "Unknown: type=4944,") {
				// This is a GE continuous fan controller, which shows up as a siren in the Almond app
				this.log("+Service.Fan");
				services.push(Service.Fan);
			}
			break;
		default:
			this.log("+Service.SwitchBinary");
			if (device.props.SwitchBinary !== undefined) {
				// Fallback to Switch
				services.push(Service.Switch);
			}
	}

	if (services.length === 0) {
		this.log("No services supported: %s [%s]", device.name, device.type);
		return;
	}

	this.log("Found %s services.", services.length);

	var uuid = UUIDGen.generate('AlmondDevice: '.concat(device.id));

	var accessory = this.accessories[uuid];
	if (accessory === undefined) {
		var accessory = new Accessory(device.name, uuid);
		this.api.registerPlatformAccessories("homebridge-platform-almond", "Almond", [accessory]);
	}


	var nameappend = '';
	for (var srvc in services) {
		var service = services[srvc];
		if (accessory.getService(service) == undefined) {

			if (service == Service.Lightbulb) {
				accessory.addService(service, device.name + nameappend).addCharacteristic(Characteristic.Brightness);
			} else if (service == Service.SmokeSensor) {
				if (Number(device.type) == deviceTypes.SmokeDetector) {
					accessory.addService(service, device.name + nameappend).addCharacteristic(Characteristic.StatusLowBattery);
				} else {
					let s = accessory.addService(service, device.name + nameappend);
					s.addCharacteristic(Characteristic.StatusLowBattery);
					s.addCharacteristic(Characteristic.StatusTampered);
				}
			} else if (service == Service.ContactSensor) {
				let s = accessory.addService(service, device.name + nameappend);
				s.addCharacteristic(Characteristic.StatusLowBattery);
				s.addCharacteristic(Characteristic.StatusTampered);
			} else if (service == Service.Switch) {
				accessory.addService(service, device.name + nameappend, device.name + nameappend);
				if (Number(device.type) == deviceTypes.MultiSwitch) {
					nameappend = " Switch 2";
					accessory.addService(service, device.name + nameappend, device.name + nameappend);
				}
			} else if (service == Service.Thermostat) {
				let s = accessory.addService(service, device.name + nameappend);
				s.addCharacteristic(Characteristic.CurrentRelativeHumidity);
				s.addCharacteristic(Characteristic.CoolingThresholdTemperature);
				s.addCharacteristic(Characteristic.HeatingThresholdTemperature);
				accessory.addService(Service.Fan, device.name + " Fan" + nameappend);
			} else if (service == Service.Fan) {
				accessory.addService(service, device.name + nameappend).addCharacteristic(Characteristic.RotationSpeed);
			} else if (service == Service.GarageDoorOpener) {
				accessory.addService(service, device.name + nameappend);
			}

		}
	}

	this.accessories[accessory.UUID] = new AlmondAccessory(this.log, accessory, device);
}

AlmondPlatform.prototype.configureAccessory = function(accessory) {
	this.log("Configuring Accessory from cache: %s [%s]", accessory.UUID, accessory.displayName);
	accessory.updateReachability(true);
	this.accessories[accessory.UUID] = accessory;
}

AlmondPlatform.prototype._pruneAccessories = function() {
	// After we have got all the devices from the Almond, check to see if we have any dead
	// cached devices and kill them.
	for (var key in this.accessories) {
		var accessory = this.accessories[key];
		this.log("Checking existance of %s:", accessory.displayName);
		if (!(accessory instanceof AlmondAccessory)) {
			this.log("(-)Did not find device for accessory %s so removing it.", accessory.displayName);
			this.api.unregisterPlatformAccessories("homebridge-platform-almond", "Almond", [accessory]);
			delete this.accessories[key];
		} else {
			this.log("(+)Device exist.");
		}
	}
}

function AlmondAccessory(log, accessory, device) {
	var self = this;
	this.accessory = accessory;
	this.device = device;
	this.log = log;

	this.displayName = this.accessory.displayName;

	this.log("Setting up: %s", accessory.displayName);

	this.updateReachability(true);

	this.accessory.getService(Service.AccessoryInformation)
		.setCharacteristic(Characteristic.Manufacturer, device.manufacturer)
		.setCharacteristic(Characteristic.Model, device.model);

	this.accessory.on('identify', function(paired, callback) {
		self.log("%s - identify", self.accessory.displayName);
		//removed since not all devices are switch.
		//ToDo - Add support for all suported accesories
		//self.getSwitchState(function(err, state) {
		//    self.setSwitchState(!state);
		callback();
		//});
	});

	this.observeDevice(device);
	this.addEventHandlers();
}

AlmondAccessory.prototype.observeDevice = function(device) {

}

AlmondAccessory.prototype.addEventHandlers = function(device) {
	var self = this;
	var servicecount = 0;

	var service = this.accessory.getService(Service.Switch);
	if (service !== undefined) {
		servicecount++;

		service.getCharacteristic(Characteristic.On)
			.on('set', this.setSwitchState.bind(this))
			.on('get', this.getSwitchState.bind(this));

		if (Number(this.device.type) == deviceTypes.MultiSwitch) {
			service = this.accessory.getService(this.device.name + " Switch 2");

			if (service !== undefined) {
				service.getCharacteristic(Characteristic.On)
					.on('set', this.setSwitchState2.bind(this))
					.on('get', this.getSwitchState2.bind(this));
			}
		}
	}

	service = this.accessory.getService(Service.Lightbulb);
	if (service !== undefined) {
		servicecount++;

		if (Number(this.device.type) == deviceTypes.MultilevelSwitch) {
			// Multilevel switch without on/off
			service.getCharacteristic(Characteristic.Brightness)
				.on('set', this.setMultilevelSwitchValue.bind(this))
				.on('get', this.getMultilevelSwitchValue.bind(this));
			service.getCharacteristic(Characteristic.On)
				.on('set', this.setMultilevelSwitchState.bind(this))
				.on('get', this.getMultilevelSwitchState.bind(this));
		} else {
			// Normal lightbulb
			service.getCharacteristic(Characteristic.Brightness)
				.on('set', this.setBrightness.bind(this))
				.on('get', this.getBrightness.bind(this));
			service.getCharacteristic(Characteristic.On)
				.on('set', this.setSwitchState.bind(this))
				.on('get', this.getSwitchState.bind(this));
		}
	}

	service = this.accessory.getService(Service.SmokeSensor);
	if (service !== undefined) {
		servicecount++;

		// Almond+ has 2 different "Smoke Sensor" types
		if (Number(this.device.type) == deviceTypes.SmokeDetector) {
			// Smoke detector
			service.getCharacteristic(Characteristic.SmokeDetected).on('get', this.getSmokeDetectorStateState.bind(this));
			service.getCharacteristic(Characteristic.StatusLowBattery).on('get', this.getSmokeDetectorLowBatteryState.bind(this));
		} else {
			// Fire sensor
			service.getCharacteristic(Characteristic.SmokeDetected).on('get', this.getStateState.bind(this));
			service.getCharacteristic(Characteristic.StatusTampered).on('get', this.getTamperState.bind(this));
			service.getCharacteristic(Characteristic.StatusLowBattery).on('get', this.getLowBatteryState.bind(this));
		}
	}

	service = this.accessory.getService(Service.ContactSensor);
	if (service !== undefined) {
		servicecount++;

		service.getCharacteristic(Characteristic.ContactSensorState).on('get', this.getStateState.bind(this));
		service.getCharacteristic(Characteristic.StatusTampered).on('get', this.getTamperState.bind(this));
		service.getCharacteristic(Characteristic.StatusLowBattery).on('get', this.getLowBatteryState.bind(this));
	}

	service = this.accessory.getService(Service.Thermostat);
	if (service !== undefined) {
		servicecount++;
		
		service.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
			.on('get', this.getCurrentHeatingCoolingState.bind(this));
		service.getCharacteristic(Characteristic.TargetHeatingCoolingState)
			.on('get', this.getTargetHeatingCoolingState.bind(this))
			.on('set', this.setTargetHeatingCoolingState.bind(this));
		service.getCharacteristic(Characteristic.CurrentTemperature)
			.on('get', this.getCurrentTemperature.bind(this));
		service.getCharacteristic(Characteristic.TargetTemperature)
			.on('get', this.getTargetTemperature.bind(this))
			.on('set', this.setTargetTemperature.bind(this));
		service.getCharacteristic(Characteristic.TemperatureDisplayUnits)
			.on('get', this.getTemperatureDisplayUnits.bind(this))
			.on('set', this.setTemperatureDisplayUnits.bind(this));
		service.getCharacteristic(Characteristic.CurrentRelativeHumidity)
			.on('get', this.getCurrentRelativeHumidity.bind(this));
		service.getCharacteristic(Characteristic.CoolingThresholdTemperature)
			.on('get', this.getCoolingThresholdTemperature.bind(this))
			.on('set', this.setCoolingThresholdTemperature.bind(this));
		service.getCharacteristic(Characteristic.HeatingThresholdTemperature)
			.on('get', this.getHeatingThresholdTemperature.bind(this))
			.on('set', this.setHeatingThresholdTemperature.bind(this));
	}

	service = this.accessory.getService(Service.Fan);
	if (service !== undefined) {
		servicecount++;

		if (Number(this.device.type) == deviceTypes.Thermostat) {
			// Thermostat fan mode switch (Auto/On)
			service.getCharacteristic(Characteristic.On)
				.on('set', this.setThermostatFanMode.bind(this))
				.on('get', this.getThermostatFanMode.bind(this));
		} else {
			// Normal fan
			service.getCharacteristic(Characteristic.On)
				.on('set', this.setMultilevelSwitchState.bind(this))
				.on('get', this.getMultilevelSwitchState.bind(this));
			service.getCharacteristic(Characteristic.RotationSpeed)
				.on('set', this.setMultilevelSwitchValue.bind(this))
				.on('get', this.getMultilevelSwitchValue.bind(this));
		}
	}
	
	service = this.accessory.getService(Service.GarageDoorOpener);
	if (service !== undefined) {
		servicecount++;
		
		service.getCharacteristic(Characteristic.CurrentDoorState)
			.on('get', this.getCurrentDoorState.bind(this));
		service.getCharacteristic(Characteristic.TargetDoorState)
			.on('get', this.getTargetDoorState.bind(this))
			.on('set', this.setTargetDoorState.bind(this));
		service.getCharacteristic(Characteristic.ObstructionDetected)
			.on('get', this.getObstructionDetected.bind(this));

	}


	if (servicecount > 0) {

		this.device.on('valueUpdated', function(prop, value) {
			self.log("Value updated: prop:%s -> value:%s id:[%s]", prop, value, this.id);
			if (this.props.SwitchBinary == prop || this.props.State == prop || this.props.Tamper == prop || this.props.LowBattery == prop) {
				if (typeof value === 'string') {
					if (value === 'true' || value === 'false') {
						value = value == 'true';
					}
					value = (value | 0) ? true : false;
				}

				self.updateBoolState(value, prop);
			}

			if (this.props.SwitchMultilevel == prop) {
				value = Math.round(value * 100 / 255);
//				self.updateBrightnessState(value);
			}
		})
	}
}


AlmondAccessory.prototype.getSwitchState = function(cb) {
	var state = this.device.getProp(this.device.props.SwitchBinary);

	if (typeof state === 'string') {
		if (state === 'true' || state === 'false') {
			state = state == 'true';
		}
	}
	state = +state;
	this.log(
		"Getting state for: %s and state is %s [%s]",
		this.accessory.displayName,
		state,
		typeof state
	);
	cb(null, state);
}

AlmondAccessory.prototype.getSwitchState2 = function(cb) {
	var state = this.device.getProp(this.device.props.SwitchBinary2);

	if (typeof state === 'string') {
		if (state === 'true' || state === 'false') {
			state = state == 'true';
		}
	}
	state = +state;
	this.log(
		"Getting state for: %s and state is %s [%s]",
		this.accessory.displayName,
		state,
		typeof state
	);
	cb(null, state);
}

AlmondAccessory.prototype.getBrightness = function(cb) {
	var brightness = this.device.getProp(this.device.props.SwitchMultilevel);
	brightness = Math.round(brightness * 100 / 255);

	this.log(
		"Getting brightness for: %s and brightness is %s [%s]",
		this.accessory.displayName,
		brightness,
		typeof brightness
	);
	cb(null, brightness);
}

AlmondAccessory.prototype.getStateState = function(cb) {
	var state = this.device.getProp(this.device.props.State);
	if (typeof state === 'string') {
		if (state === 'true' || state === 'false') {
			state = state == 'true';
		}
	}
	state = +state;
	this.log(
		"Getting state for: %s and state is %s [%s]",
		this.accessory.displayName,
		state,
		typeof state
	);
	cb(null, state);
}

AlmondAccessory.prototype.getTamperState = function(cb) {
	var state = this.device.getProp(this.device.props.Tamper);

	if (typeof state === 'string') {
		if (state === 'true' || state === 'false') {
			state = state == 'true';
		}
	}
	state = +state;
	this.log(
		"Getting tamper state for: %s and state is %s [%s]",
		this.accessory.displayName,
		state,
		typeof state
	);
	cb(null, state);
}

AlmondAccessory.prototype.getLowBatteryState = function(cb) {
	var state = this.device.getProp(this.device.props.LowBattery);
	if (typeof state === 'string') {
		if (state === 'true' || state === 'false') {
			state = state == 'true';
		}
	}
	state = +state;
	this.log(
		"Getting LowBattery state for: %s and state is %s [%s]",
		this.accessory.displayName,
		state,
		typeof state
	);
	cb(null, state);
}


AlmondAccessory.prototype.setSwitchState = function(state, cb) {
	this.log("Setting switch [%s] to: %s [%s]", this.accessory.displayName, state, typeof state);
	var value = (state | 0) ? true : false;

	this.device.setProp(this.device.props.SwitchBinary, value, function() {
		if (cb) cb(null);
	});
}
AlmondAccessory.prototype.setSwitchState2 = function(state, cb) {
	this.log("Setting switch [%s] to: %s [%s]", this.accessory.displayName, state, typeof state);
	var value = (state | 0) ? true : false;

	this.device.setProp(this.device.props.SwitchBinary2, value, function() {
		if (cb) cb(null);
	});
}

AlmondAccessory.prototype.setBrightness = function(state, cb) {
	this.log("Setting brightness [%s] to: %s - %s % [%s]", this.accessory.displayName, Math.round(state * 255 / 100), state, typeof state);

	this.device.setProp(this.device.props.SwitchMultilevel, String(Math.round(state * 255 / 100)), function() {
		if (cb) cb(null);
	});
}

AlmondAccessory.prototype.updateBoolState = function(value, prop) {

	prop = parseInt(prop, 10);

	if (this.device.type == '4') {

		this.log("Updating Lightbulb state to: %s [%s]", value, typeof value);
		service = this.accessory.getService(Service.Lightbulb);
		service.getCharacteristic(Characteristic.On).updateValue(value);

	} else if (this.device.type == '13') {

		service = this.accessory.getService(Service.SmokeSensor);

		switch (prop) {

			case this.device.props.State:
				this.log("Updating SmokeSensor state to: %s [%s]", value, typeof value);
				service.getCharacteristic(Characteristic.SmokeDetected).updateValue(value ? Characteristic.SmokeDetected.SMOKE_DETECTED : Characteristic.SmokeDetected.SMOKE_NOT_DETECTED);
				break;
			case this.device.props.Tamper:
				this.log("Updating SmokeSensor tampered to: %s [%s]", value, typeof value);
				service.getCharacteristic(Characteristic.StatusTampered).updateValue(value ? Characteristic.StatusTampered.TAMPERED : Characteristic.StatusTampered.NOT_TAMPERED);
				break;
			case this.device.props.LowBattery:
				this.log("Updating SmokeSensor low battery to: %s [%s]", value, typeof value);
				service.getCharacteristic(Characteristic.StatusLowBattery).updateValue(value ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
				break;

		}
	} else if (this.device.type == '12') {
		service = this.accessory.getService(Service.ContactSensor);
		switch (prop) {

			case this.device.props.State:
				this.log("Updating ContactSensor state to: %s [%s]", value, typeof value);
				service.getCharacteristic(Characteristic.ContactSensorState).updateValue(value ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED : Characteristic.ContactSensorState.CONTACT_DETECTED);
				break;
			case this.device.props.Tamper:
				this.log("Updating ContactSensor tampered to: %s [%s]", value, typeof value);
				service.getCharacteristic(Characteristic.StatusTampered).updateValue(value ? Characteristic.StatusTampered.TAMPERED : Characteristic.StatusTampered.NOT_TAMPERED);
				break;
			case this.device.props.LowBattery:
				this.log("Updating ContactSensor low battery to: %s [%s]", value, typeof value ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
				service.getCharacteristic(Characteristic.StatusLowBattery).updateValue(value);
				break;

		}
		//test for temperature service
	} else {
		this.log("Updating Switch State to: %s [%s]", value, typeof value);
		var service = this.accessory.getService(Service.Switch);
		service.getCharacteristic(Characteristic.On).updateValue(value);
	}

}

AlmondAccessory.prototype.updateBrightnessState = function(value) {
	this.log("Updating Brightness State to: %s [%s]", value, typeof value);

	var service = this.accessory.getService(Service.Lightbulb);
	if (service !== undefined) {
		service.getCharacteristic(Characteristic.Brightness).updateValue(value);
	}
}

AlmondAccessory.prototype.getCurrentHeatingCoolingState = function(cb) {
	var state = this.device.getProp(this.device.props.OperatingState);

	var states = {
		"Idle": Characteristic.CurrentHeatingCoolingState.OFF,
		"Heating": Characteristic.CurrentHeatingCoolingState.HEAT,
		"Cooling": Characteristic.CurrentHeatingCoolingState.COOL
	}

	this.log(
		"Getting operating state for: %s and state is %s [%s]",
		this.accessory.displayName,
		state,
		typeof state
	);
	cb(null, states[state]);
}

AlmondAccessory.prototype.getTargetHeatingCoolingState = function(cb) {
	var state = this.device.getProp(this.device.props.Mode);

	var states = {
		"Off": Characteristic.TargetHeatingCoolingState.OFF,
		"Heat": Characteristic.TargetHeatingCoolingState.HEAT,
		"Cool": Characteristic.TargetHeatingCoolingState.COOL,
		"Auto": Characteristic.TargetHeatingCoolingState.AUTO
	}

	this.log(
		"Getting operating mode for: %s and mode is %s [%s]",
		this.accessory.displayName,
		state,
		typeof state
	);
	cb(null, states[state]);
}

AlmondAccessory.prototype.setTargetHeatingCoolingState = function(state, cb) {
	this.log("Setting operating mode [%s] to: %s [%s]", this.accessory.displayName, state, typeof state);
	// var value = (state | 0) ? true:false;

	var states = [];
	states[Characteristic.TargetHeatingCoolingState.OFF] = "Off";
	states[Characteristic.TargetHeatingCoolingState.HEAT] = "Heat";
	states[Characteristic.TargetHeatingCoolingState.COOL] = "Cool";
	states[Characteristic.TargetHeatingCoolingState.AUTO] = "Auto";

	this.device.setProp(this.device.props.Mode, states[state], function() {
		if (cb) cb(null);
	});
}

AlmondAccessory.prototype.getCurrentTemperature = function(cb) {
	var units = this.device.getProp(this.device.props.Units);
	var temperature = Number(this.device.getProp(this.device.props.Temperature));
	if (units == "F") {
		temperature = (temperature - 32) / 1.8;
	}
	temperature = Number(temperature.toFixed(1));

	this.log(
		"Getting current temperature for: %s and temperature is %f degrees C [%s]",
		this.accessory.displayName,
		temperature,
		typeof temperature
	);
	cb(null, temperature);
}

AlmondAccessory.prototype.getTargetTemperature = function(cb) {
	var units = this.device.getProp(this.device.props.Units);
	var mode = this.device.getProp(this.device.props.Mode);
	var targetTemperature = 0;
	if (mode == "Heat") {
		targetTemperature = Number(this.device.getProp(this.device.props.SetpointHeating));
	} else if (mode == "Cool") {
		targetTemperature = Number(this.device.getProp(this.device.props.SetpointCooling));
	} else if (mode == "Auto" || mode == "Off") {
		// This is bogus, but we have to give an answer
		let heatingTemperature = Number(this.device.getProp(this.device.props.SetpointHeating));
		let coolingTemperature = Number(this.device.getProp(this.device.props.SetpointCooling));
		targetTemperature = Number(((heatingTemperature + coolingTemperature) / 2).toFixed(1));
	}
	if (units == "F") {
		targetTemperature = (targetTemperature - 32) / 1.8;
	}
	targetTemperature = Number(targetTemperature.toFixed(1));

	this.log(
		"Getting current target temperature for: %s and temperature is %f degrees C [%s]",
		this.accessory.displayName,
		targetTemperature,
		typeof targetTemperature
	);
	cb(null, targetTemperature);
}

AlmondAccessory.prototype.setTargetTemperature = function(temperature, cb) {
	this.log("Setting target temperature [%s] to: %f degrees C [%s]", this.accessory.displayName, temperature, typeof temperature);

	var units = this.device.getProp(this.device.props.Units);
	var mode = this.device.getProp(this.device.props.Mode);
	var targetTemperature = temperature;
	if (units == "F") {
		targetTemperature = targetTemperature * 1.8 + 32;
		// Not sure if this 0.5-degree rounding is necessary
		targetTemperature = Number(Math.round(targetTemperature * 2) / 2).toString();
	}
	if (mode == "Heat") {
		this.device.setProp(this.device.props.SetpointHeating, targetTemperature, function() {
			if (cb) cb(null);
		});
	} else if (mode == "Cool") {
		this.device.setProp(this.device.props.SetpointCooling, targetTemperature, function() {
			if (cb) cb(null);
		});
	} else {
		cb(null);
	}
}

AlmondAccessory.prototype.getTemperatureDisplayUnits = function(cb) {
	var units = this.device.getProp(this.device.props.Units);

	var unitTypes = {
		"C": Characteristic.TemperatureDisplayUnits.CELSIUS,
		"F": Characteristic.TemperatureDisplayUnits.FAHRENHEIT
	}

	this.log(
		"Getting temperature display units for: %s and units are %s [%s]",
		this.accessory.displayName,
		units,
		typeof units
	);
	cb(null, unitTypes[units]);
}

AlmondAccessory.prototype.setTemperatureDisplayUnits = function(units, cb) {
	var unitTypes = [];
	unitTypes[Characteristic.TemperatureDisplayUnits.CELSIUS] = "C";
	unitTypes[Characteristic.TemperatureDisplayUnits.FAHRENHEIT] = "F";

	this.log("Setting temperature display units [%s] to: %s [%s]", this.accessory.displayName, unitTypes[units], typeof unitTypes[units]);

	// Just run the callback with no error; Almond+ doesn't allow this to be set
	cb(null);

//	this.device.setProp(this.device.props.Units, unitTypes[units], function() {
//		if (cb) cb(null);
//	});
}

AlmondAccessory.prototype.getCurrentRelativeHumidity = function(cb) {
	var humidity = this.device.getProp(this.device.props.Humidity);
	humidity = Math.round(Number(humidity));
	this.log(
		"Getting current relative humidity for: %s and humidity is %i % [%s]",
		this.accessory.displayName,
		humidity,
		typeof humidity
	);
	cb(null, humidity);
}

AlmondAccessory.prototype.getCoolingThresholdTemperature = function(cb) {
	var units = this.device.getProp(this.device.props.Units);
	var coolingTemperature = Number(this.device.getProp(this.device.props.SetpointCooling));
	if (units == "F") {
		coolingTemperature = (coolingTemperature - 32) / 1.8;
	}
	coolingTemperature = Number(coolingTemperature.toFixed(1));

	this.log(
		"Getting current cooling temperature threshold for: %s and temperature is %f degrees C [%s]",
		this.accessory.displayName,
		coolingTemperature,
		typeof coolingTemperature
	);
	cb(null, coolingTemperature);
}

AlmondAccessory.prototype.setCoolingThresholdTemperature = function(temperature, cb) {
	this.log("Setting cooling temperature threshold [%s] to: %f degrees C [%s]", this.accessory.displayName, temperature, typeof temperature);

	var mode = this.device.getProp(this.device.props.Mode);
	if (mode == "Auto") {
		// This property should only be set in Auto mode
		var units = this.device.getProp(this.device.props.Units);
		var coolingTemperature = temperature;
		if (units == "F") {
			coolingTemperature = coolingTemperature * 1.8 + 32;
			// Not sure if this 0.5-degree rounding is necessary
			coolingTemperature = Number(Math.round(coolingTemperature * 2) / 2).toString();
		}
		this.device.setProp(this.device.props.SetpointCooling, coolingTemperature, function() {
			if (cb) cb(null);
		});
	} else {
		// Run callback with no error
		cb(null);
	}
}

AlmondAccessory.prototype.getHeatingThresholdTemperature = function(cb) {
	var units = this.device.getProp(this.device.props.Units);
	var heatingTemperature = Number(this.device.getProp(this.device.props.SetpointHeating));
	if (units == "F") {
		heatingTemperature = (heatingTemperature - 32) / 1.8;
	}
	heatingTemperature = Number(heatingTemperature.toFixed(1));

	this.log(
		"Getting current heating temperature threshold for: %s and temperature is %f degrees C [%s]",
		this.accessory.displayName,
		heatingTemperature,
		typeof heatingTemperature
	);
	cb(null, heatingTemperature);
}

AlmondAccessory.prototype.setHeatingThresholdTemperature = function(temperature, cb) {
	this.log("Setting heating temperature threshold [%s] to: %f degrees C [%s]", this.accessory.displayName, temperature, typeof temperature);

	var mode = this.device.getProp(this.device.props.Mode);
	if (mode == "Auto") {
		// This property should only be set in Auto mode
		var units = this.device.getProp(this.device.props.Units);
		var heatingTemperature = temperature;
		if (units == "F") {
			heatingTemperature = heatingTemperature * 1.8 + 32;
			// Not sure if this 0.5-degree rounding is necessary
			heatingTemperature = Number(Math.round(heatingTemperature * 2) / 2).toString();
		}
		this.device.setProp(this.device.props.SetpointHeating, heatingTemperature, function() {
			if (cb) cb(null);
		});
	} else {
		// Run callback with no error
		cb(null);
	}
}

AlmondAccessory.prototype.getThermostatFanMode = function(cb) {
	var fanMode = this.device.getProp(this.device.props.FanMode);
	this.log(
		"Getting fan mode for: %s and mode is %s [%s]",
		this.accessory.displayName,
		fanMode,
		typeof fanMode
	);
	cb(null, fanMode == "On Low");
}

AlmondAccessory.prototype.setThermostatFanMode = function(state, cb) {
	this.log("Setting thermostat fan mode [%s] to: %s [%s]", this.accessory.displayName, state, typeof state);

	this.device.setProp(this.device.props.FanMode, state ? "On Low" : "Auto Low", function() {
		if (cb) cb(null);
	});
}


AlmondAccessory.prototype.updateReachability = function(reachable) {
	this.accessory.updateReachability(reachable);
}



// Below is experimental code. Once tested, it will appear above this line.

AlmondAccessory.prototype.getMultilevelSwitchState = function(cb) {
	var value = Number(this.device.getProp(this.device.props.SwitchMultilevel));
	var state = value > 0;

	this.log(
		"Getting state for: %s and state is %s [%s]",
		this.accessory.displayName,
		state,
		typeof state
	);
	cb(null, state);
}

AlmondAccessory.prototype.setMultilevelSwitchState = function(state, cb) {
	this.log("Setting state [%s] to: %s [%s]", this.accessory.displayName, state, typeof state);

	var value;
	if (state) {
		value = this.device._CachedMultilevelSwitchValue;
	} else {
		value = '0';
		this.device._CachedMultilevelSwitchValue = this.device.getProp(this.device.props.SwitchMultilevel);
	}

	this.device.setProp(this.device.props.SwitchMultilevel, value, function() {
		if (cb) cb(null);
	});
}

AlmondAccessory.prototype.getMultilevelSwitchValue = function(cb) {
	var value = Number(this.device.getProp(this.device.props.SwitchMultilevel));
	value = Math.round(value * 100 / 255);

	this.log(
		"Getting value for: %s and value is %s % [%s]",
		this.accessory.displayName,
		value,
		typeof value
	);
	cb(null, value);
}

AlmondAccessory.prototype.setMultilevelSwitchValue = function(value, cb) {
	this.log("Setting value [%s] to: %s - %s % [%s]", this.accessory.displayName, Math.round(value * 255 / 100), value, typeof value);

	this.device.setProp(this.device.props.SwitchMultilevel, Math.round(value * 255 / 100), function() {
		if (cb) cb(null);
	});
}

AlmondAccessory.prototype.getCurrentDoorState = function(cb) {
	var states = {
		"0": Characteristic.CurrentDoorState.CLOSED,
		"252": Characteristic.CurrentDoorState.CLOSING,
		"253": Characteristic.CurrentDoorState.STOPPED,
		"254": Characteristic.CurrentDoorState.OPENING,
		"255": Characteristic.CurrentDoorState.OPEN
	}
	var state = this.device.getProp(this.device.props.BarrierOperator);

	this.log(
		"Getting current door state for: %s and state is %s [%s]",
		this.accessory.displayName,
		states[state],
		typeof states[state]
	);
	cb(null, states[state]);
}

AlmondAccessory.prototype.getTargetDoorState = function(cb) {
	var targetState;
	if (this.device._targetDoorState !== undefined) {
		targetState = this.device._targetDoorState;
	} else {
		let currentState = this.device.getProp(this.device.props.BarrierOperator);
		if (currentState == "0" || currentState == "252") {
			targetState = Characteristic.TargetDoorState.CLOSED;
		} else if (currentState == "255" || currentState == "254") {
			targetState = Characteristic.TargetDoorState.OPEN;
		} else {
			// Not sure if this is the best default, but we have to answer
			targetState = Characteristic.TargetDoorState.CLOSED;
		}
	}

	this.log(
		"Getting target door state for: %s and state is %s [%s]",
		this.accessory.displayName,
		targetState,
		typeof targetState
	);
	cb(null, targetState);
}

AlmondAccessory.prototype.setTargetDoorState = function(state, cb) {
	this.log("Setting target door state [%s] to: %s [%s]", this.accessory.displayName, state, typeof state);

	var states = [];
	states[Characteristic.TargetDoorState.OPEN] = "255";
	states[Characteristic.TargetDoorState.CLOSED] = "0";	

	this.device.setProp(this.device.props.BarrierOperator, states[state], function() {
		if (cb) cb(null);
	});
}

AlmondAccessory.prototype.getObstructionDetected = function(cb) {
	var obstruction = this.device.getProp(this.device.props.BarrierOperator) == "253";

	this.log(
		"Getting obstruction detected for: %s and detected is %s [%s]",
		this.accessory.displayName,
		obstruction,
		typeof obstruction
	);
	cb(null, obstruction);
}

AlmondAccessory.prototype.getSmokeDetectorStateState = function(cb) {
	var state = Number(this.device.getProp(this.device.props.Status) > 0);
	state = Number(state);

	var states = [
		Characteristic.SmokeDetected.SMOKE_NOT_DETECTED,
		Characteristic.SmokeDetected.SMOKE_DETECTED
	]

	this.log(
		"Getting smoke detected for: %s and detected is %s [%s]",
		this.accessory.displayName,
		states[state],
		typeof states[state]
	);
	cb(null, states[state]);
}

AlmondAccessory.prototype.getSmokeDetectorLowBatteryState = function(cb) {
	var state = Number(this.device.getProp(this.device.props.Battery) <= 20);
	state = Number(state);

	var states = [
		Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
		Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
	]

	this.log(
		"Getting low battery state for: %s and state is %s [%s]",
		this.accessory.displayName,
		states[state],
		typeof states[state]
	);
	cb(null, states[state]);
}

