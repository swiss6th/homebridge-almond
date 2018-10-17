"use strict";

var Almond = require('almond-client'),
	deviceType = require('almond-client/deviceTypes'),
	deviceProperty = require('almond-client/deviceProperties'),
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

class AlmondPlatform {
	constructor(log, config, api) {
		var platform = this;
		this.log = log;
		this.config = config;
		this.api = api;
	
		this.accessories = [];
	
		this.log("Starting up, config: ", config);
	
		this.api.on('didFinishLaunching', function() {
			platform.client = new Almond(platform.config);
	
			platform.client.on("ready", function() {
				platform.client.getDevices().forEach(platform.addAccessory.bind(platform));
				platform._pruneAccessories();
			});
		});
	}

	addAccessory(device) {
		var platform = this;
		this.log("Got device. Name: %s, ID: %s, Type: %s", device.name, device.id, device.type)
	
		if (device.props === undefined) {
			this.log("Device not supported.");
			return;
		}
	
		var uuid = UUIDGen.generate('AlmondDevice: '.concat(device.id));	
		var accessory = new Accessory(device.name, uuid);

		var almondAccessory;
		switch (Number(device.type)) {
			case deviceType.MultilevelSwitch:
				almondAccessory = new AlmondMultilevelSwitch(this.log, accessory, device);
				break;
			case deviceType.MultilevelSwitchOnOff:
				almondAccessory = new AlmondMultilevelSwitchOnOff(this.log, accessory, device);
				break;
			case deviceType.Thermostat:
				almondAccessory = new AlmondThermostat(this.log, accessory, device);
				break;
			case deviceType.ContactSwitch:
				almondAccessory = new AlmondContactSwitch(this.log, accessory, device);
				break;
			case deviceType.FireSensor:
				almondAccessory = new AlmondFireSensor(this.log, accessory, device);
				break;
			case deviceType.SmokeDetector:
				almondAccessory = new AlmondSmokeDetector(this.log, accessory, device);
				break;
			case deviceType.GarageDoorOpener:
				almondAccessory = new AlmondGarageDoorOpener(this.log, accessory, device);
				break;
			case deviceType.GenericPSM:
				if (
					device.manufacturer == "GE" &&
					device.model == "Unknown: type=4944,"
				) {
					// This is a GE continuous fan controller, which shows up as a siren in the Almond app
					almondAccessory = new AlmondGenericPsmFan(this.log, accessory, device);
				}
				break;
			case deviceType.BinarySwitch:
				almondAccessory = new AlmondBinarySwitch(this.log, accessory, device);
				break;
			case deviceType.MultilevelSwitch:
				almondAccessory = new AlmondMultilevelSwitch(this.log, accessory, device);
				break;
			default:
				if (device.props.SwitchBinary !== undefined) {
					// Fallback to Switch
					almondAccessory = new AlmondBinarySwitch(this.log, accessory, device);
				}
		}
		
		if (almondAccessory === undefined) {
			this.log("No services supported: %s [%s]", device.name, device.type);
			return;
		}

		var existingAccessory = this.accessories[uuid];
		if (existingAccessory === undefined) {
			this.api.registerPlatformAccessories("homebridge-platform-almond", "Almond", [accessory]);
		} else {
			almondAccessory.accessory = existingAccessory;
		}
	
		this.accessories[almondAccessory.accessory.UUID] = almondAccessory;
	}
	
	configureAccessory(accessory) {
		this.log("Configuring Accessory from cache: %s [%s]", accessory.UUID, accessory.displayName);
		accessory.updateReachability(true);
		this.accessories[accessory.UUID] = accessory;
	}
	
	_pruneAccessories() {
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
}

class AlmondAccessory {
	constructor(log, accessory, device) {
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
	}

	observeDevice(device) {
	}

	getSwitchState() {
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

		return state;
	}

	getSwitchState2() {
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

		return state;
	}

	getBrightness() {
		var brightness = this.device.getProp(this.device.props.SwitchMultilevel);
		brightness = Math.round(brightness * 100 / 255);
	
		this.log(
			"Getting brightness for: %s and brightness is %s [%s]",
			this.accessory.displayName,
			brightness,
			typeof brightness
		);

		return brightness;
	}

	getStateState() {
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

		return state;
	}

	getTamperState() {
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

		return state;
	}

	getLowBatteryState() {
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

		return state;
	}

	setSwitchState(state) {
		this.log("Setting switch [%s] to: %s [%s]", this.accessory.displayName, state, typeof state);
		var value = (state | 0) ? true : false;
	
		this.device.setProp(this.device.props.SwitchBinary, value, function() {});
	}

	setSwitchState2(state) {
		this.log("Setting switch [%s] to: %s [%s]", this.accessory.displayName, state, typeof state);
		var value = (state | 0) ? true : false;
	
		this.device.setProp(this.device.props.SwitchBinary2, value, function() {});
	}
	
	setBrightness(state) {
		this.log("Setting brightness [%s] to: %s - %s % [%s]", this.accessory.displayName, Math.round(state * 255 / 100), state, typeof state);
	
		this.device.setProp(this.device.props.SwitchMultilevel, String(Math.round(state * 255 / 100)), function() {});
	}
	
	updateBoolState(value, prop) {
	
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
	
	updateBrightnessState(value) {
		this.log("Updating Brightness State to: %s [%s]", value, typeof value);
	
		var service = this.accessory.getService(Service.Lightbulb);
		if (service !== undefined) {
			service.getCharacteristic(Characteristic.Brightness).updateValue(value);
		}
	}
	
	updateReachability(reachable) {
		this.accessory.updateReachability(reachable);
	}

	/////////////////////////////////////////////////////// This is how we receive device updates from Almond+
		
	updateMultilevelSwitch(prop, value) {
		this.log("Value updated: prop:%s -> value:%s id:[%s]", prop, value, this.id);
		
		// Handle update from Almond+
		// Go through each property of the device.
		// Whatever matches this update, send the update to HomeKit.
		
		if (this.props.SwitchBinary == prop || this.props.State == prop || this.props.Tamper == prop || this.props.LowBattery == prop) {
			if (typeof value === 'string') {
				if (value === 'true' || value === 'false') {
					value = value == 'true';
				}
				value = (value | 0) ? true : false;
			}
	
			this.updateBoolState(value, prop);
		}
	
		if (this.props.SwitchMultilevel == prop) {
			value = Math.round(value * 100 / 255);
	//				self.updateBrightnessState(value);
		}
	}	
}

// Almond+ accessory classes

class AlmondMultilevelSwitch extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device);

		this.log("+Service.Lightbulb (MultilevelSwitch)");
		let service = accessory.addService(Service.Lightbulb, device.name);

		service.getCharacteristic(Characteristic.On)
			.on('get', (callback) => {
				callback(null, this.getMultilevelSwitchState());
			})
			.on('set', (value, callback) => {
				callback(null);
				this.setMultilevelSwitchState(value);
			})

		service.addCharacteristic(Characteristic.Brightness)
			.on('get', (callback) => {
				callback(null, this.getMultilevelSwitchValue());
			})
			.on('set', (value, callback) => {
				callback(null);
				this.setMultilevelSwitchValue(value);
			})
//				this.device.on('valueUpdated', this.updateMultilevelSwitch.bind(this));

		this.log("Found 1 service.");
	}
	
	getMultilevelSwitchState() {
		var value = Number(this.device.getProp(this.device.props.SwitchMultilevel));
		var state = value > 0;
	
		this.log(
			"Getting state for: %s and state is %s [%s]",
			this.accessory.displayName,
			state,
			typeof state
		);
		return state;
	}
	
	setMultilevelSwitchState(state) {
		this.log("Setting state [%s] to: %s [%s]", this.accessory.displayName, state, typeof state);
	
		var value;
		if (state) {
			value = this.device._CachedMultilevelSwitchValue;
		} else {
			value = '0';
			this.device._CachedMultilevelSwitchValue = this.device.getProp(this.device.props.SwitchMultilevel);
		}
	
		this.device.setProp(this.device.props.SwitchMultilevel, value, function() {});
	}
	
	getMultilevelSwitchValue() {
		var value = Number(this.device.getProp(this.device.props.SwitchMultilevel));
	
		this.log(
			"Getting value for: %s and value is %s % [%s]",
			this.accessory.displayName,
			value,
			typeof value
		);

		return value;
	}
	
	setMultilevelSwitchValue(value) {
		this.log("Setting value [%s] to: %s % [%s]", this.accessory.displayName, value, typeof value);
	
		this.device.setProp(this.device.props.SwitchMultilevel, String(value), function() {});
	}
}

class AlmondMultilevelSwitchOnOff extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device);

		this.log("+Service.Lightbulb");
		let service = accessory.addService(Service.Lightbulb, device.name);

		service.getCharacteristic(Characteristic.On)
			.on('get', (callback) => {
				callback(null, this.getSwitchState());
			})
			.on('set', (value, callback) => {
				callback(null);
				this.setSwitchState(value);
			});

		service.addCharacteristic(Characteristic.Brightness)
			.on('get', (callback) => {
				callback(null, this.getBrightness());
			})
			.on('set', (value, callback) => {
				callback(null);
				this.setBrightness(value);
			})

		this.log("Found 1 service.");
	}
}

class AlmondThermostat extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device);

		this.log("+Service.Thermostat");
		let service = accessory.addService(Service.Thermostat, device.name);

		service.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
			.on('get', (callback) => {
				callback(null, this.getCurrentHeatingCoolingState());
			});

		service.getCharacteristic(Characteristic.TargetHeatingCoolingState)
			.on('get', (callback) => {
				callback(null, this.getTargetHeatingCoolingState());
			})
			.on('set', (value, callback) => {
				callback(null);
				this.setTargetHeatingCoolingState(value);
			});

		service.getCharacteristic(Characteristic.CurrentTemperature)
			.on('get', (callback) => {
				callback(null, this.getCurrentTemperature());
			});

		service.getCharacteristic(Characteristic.TargetTemperature)
			.on('get', (callback) => {
				callback(null, this.getTargetTemperature());
			})
			.on('set', (value, callback) => {
				callback(null);
				this.setTargetTemperature(value);
			});

		service.getCharacteristic(Characteristic.TemperatureDisplayUnits)
			.on('get', (callback) => {
				callback(null, this.getTemperatureDisplayUnits());
			})
			.on('set', (value, callback) => {
				callback(null);
				this.setTemperatureDisplayUnits(value);
			});

		service.addCharacteristic(Characteristic.CurrentRelativeHumidity)
			.on('get', (callback) => {
				callback(null, this.getCurrentRelativeHumidity());
			});

		service.addCharacteristic(Characteristic.CoolingThresholdTemperature)
			.on('get', (callback) => {
				callback(null, this.getCoolingThresholdTemperature());
			})
			.on('set', (value, callback) => {
				callback(null);
				this.setCoolingThresholdTemperature(value);
			});

		service.addCharacteristic(Characteristic.HeatingThresholdTemperature)
			.on('get', (callback) => {
				callback(null, this.getHeatingThresholdTemperature());
			})
			.on('set', (value, callback) => {
				callback(null);
				this.setHeatingThresholdTemperature(value);
			});

		this.log("+Service.Fan");
		service = accessory.addService(Service.Fan, device.name + " Fan");

		service.getCharacteristic(Characteristic.On)
			.on('get', (callback) => {
				callback(null, this.getThermostatFanMode());
			})
			.on('set', (value, callback) => {
				callback(null);
				this.setThermostatFanMode(value);
			});

		this.log("Found 2 services.");
	}

	getCurrentHeatingCoolingState() {
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

		return states[state];
	}
	
	getTargetHeatingCoolingState() {
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

		return states[state];
	}
	
	setTargetHeatingCoolingState(state) {
		this.log("Setting operating mode [%s] to: %s [%s]", this.accessory.displayName, state, typeof state);
		// var value = (state | 0) ? true:false;
	
		var states = [];
		states[Characteristic.TargetHeatingCoolingState.OFF] = "Off";
		states[Characteristic.TargetHeatingCoolingState.HEAT] = "Heat";
		states[Characteristic.TargetHeatingCoolingState.COOL] = "Cool";
		states[Characteristic.TargetHeatingCoolingState.AUTO] = "Auto";
	
		this.device.setProp(this.device.props.Mode, states[state], function() {});
	}
	
	getCurrentTemperature() {
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

		return temperature;
	}
	
	getTargetTemperature() {
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

		return targetTemperature;
	}
	
	setTargetTemperature(temperature) {
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
			this.device.setProp(this.device.props.SetpointHeating, targetTemperature, function() {});
		} else if (mode == "Cool") {
			this.device.setProp(this.device.props.SetpointCooling, targetTemperature, function() {});
		}
	}
	
	getTemperatureDisplayUnits() {
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

		return unitTypes[units];
	}
	
	setTemperatureDisplayUnits(units) {
		var unitTypes = [];
		unitTypes[Characteristic.TemperatureDisplayUnits.CELSIUS] = "C";
		unitTypes[Characteristic.TemperatureDisplayUnits.FAHRENHEIT] = "F";
	
		this.log("Setting temperature display units [%s] to: %s [%s]", this.accessory.displayName, unitTypes[units], typeof unitTypes[units]);
	
		// Almond+ doesn't allow this to be set
		//this.device.setProp(this.device.props.Units, unitTypes[units], function() {});
	}
	
	getCurrentRelativeHumidity() {
		var humidity = this.device.getProp(this.device.props.Humidity);
		humidity = Math.round(Number(humidity));

		this.log(
			"Getting current relative humidity for: %s and humidity is %i % [%s]",
			this.accessory.displayName,
			humidity,
			typeof humidity
		);

		return humidity;
	}
	
	getCoolingThresholdTemperature() {
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

		return coolingTemperature;
	}
	
	setCoolingThresholdTemperature(temperature) {
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

			this.device.setProp(this.device.props.SetpointCooling, coolingTemperature, function() {});
		}
	}
	
	getHeatingThresholdTemperature() {
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

		return heatingTemperature;
	}
	
	setHeatingThresholdTemperature(temperature) {
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

			this.device.setProp(this.device.props.SetpointHeating, heatingTemperature, function() {});
		}
	}
	
	getThermostatFanMode() {
		var fanMode = this.device.getProp(this.device.props.FanMode);

		this.log(
			"Getting fan mode for: %s and mode is %s [%s]",
			this.accessory.displayName,
			fanMode,
			typeof fanMode
		);

		return fanMode == "On Low";
	}
	
	setThermostatFanMode(state) {
		this.log("Setting thermostat fan mode [%s] to: %s [%s]", this.accessory.displayName, state, typeof state);
	
		this.device.setProp(this.device.props.FanMode, state ? "On Low" : "Auto Low", function() {});
	}
}

class AlmondContactSwitch extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device);

		this.log("+Service.ContactSensor");
		let service = accessory.addService(Service.ContactSensor, device.name);

		service.getCharacteristic(Characteristic.ContactSensorState)
			.on('get', (callback) => {
				callback(null, this.getStateState());
			});

		service.addCharacteristic(Characteristic.StatusTampered)
			.on('get', (callback) => {
				callback(null, this.getTamperState());
			});

		service.addCharacteristic(Characteristic.StatusLowBattery)
			.on('get', (callback) => {
				callback(null, this.getLowBatteryState());
			});

		this.log("Found 1 service.");
		// ToDo: test for temperature sensor service
	}
}

class AlmondFireSensor extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device);

		this.log("+Service.SmokeSensor");
		let service = accessory.addService(Service.SmokeSensor, device.name);

		service.getCharacteristic(Characteristic.SmokeDetected)
			.on('get', (callback) => {
				callback(null, this.getStateState());
			});

		service.addCharacteristic(Characteristic.StatusTampered)
			.on('get', (callback) => {
				callback(null, this.getTamperState());
			});

		service.addCharacteristic(Characteristic.StatusLowBattery)
			.on('get', (callback) => {
				callback(null, this.getLowBatteryState());
			});

		this.log("Found 1 service.");
	}
}

class AlmondSmokeDetector extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device);

		this.log("+Service.SmokeSensor");
		let service = accessory.addService(Service.SmokeSensor, device.name);

		service.getCharacteristic(Characteristic.SmokeDetected)
			.on('get', (callback) => {
				callback(null, this.getSmokeDetectorStateState());
			});

		service.addCharacteristic(Characteristic.StatusLowBattery)
			.on('get', (callback) => {
				callback(null, this.getSmokeDetectorLowBatteryState());
			});

		this.log("Found 1 service.");
	}
	
	getSmokeDetectorStateState() {
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

		return states[state];
	}
	
	getSmokeDetectorLowBatteryState() {
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

		return states[state];
	}	
}

class AlmondGarageDoorOpener extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device);

		this.log("+Service.GarageDoorOpener");
		let service = accessory.addService(Service.GarageDoorOpener, device.name);

		service.getCharacteristic(Characteristic.CurrentDoorState)
			.on('get', (callback) => {
				callback(null, this.getCurrentDoorState());
			});

		service.getCharacteristic(Characteristic.TargetDoorState)
			.on('get', (callback) => {
				callback(null, this.getTargetDoorState());
			})
			.on('set', (value, callback) => {
				callback(null);
				this.setTargetDoorState(value);
			});

		service.getCharacteristic(Characteristic.ObstructionDetected)
			.on('get', (callback) => {
				callback(null, this.getObstructionDetected());
			});

		this.log("Found 1 service.");
	}

	getCurrentDoorState() {
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

		return states[state];
	}
	
	getTargetDoorState() {
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

		return targetState;
	}
	
	setTargetDoorState(state) {
		this.log("Setting target door state [%s] to: %s [%s]", this.accessory.displayName, state, typeof state);
	
		var states = [];
		states[Characteristic.TargetDoorState.OPEN] = "255";
		states[Characteristic.TargetDoorState.CLOSED] = "0";	
	
		this.device.setProp(this.device.props.BarrierOperator, states[state], function() {});
	}
	
	getObstructionDetected() {
		var obstruction = this.device.getProp(this.device.props.BarrierOperator) == "253";
	
		this.log(
			"Getting obstruction detected for: %s and detected is %s [%s]",
			this.accessory.displayName,
			obstruction,
			typeof obstruction
		);

		return obstruction;
	}
}

class AlmondGenericPsmFan extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device);

		this.log("+Service.Fan");
		let service = accessory.addService(Service.Fan, device.name);

		service.getCharacteristic(Characteristic.On)
			.on('get', (callback) => {
				callback(null, this.getMultilevelSwitchState());
			})
			.on('set', (value, callback) => {
				callback(null);
				this.setMultilevelSwitchState(value);
			});

		service.addCharacteristic(Characteristic.RotationSpeed)
			.on('get', (callback) => {
				callback(null, this.getMultilevelSwitchValue());
			})
			.on('set', (value, callback) => {
				callback(null);
				this.setMultilevelSwitchValue(value);
			});

		this.log("Found 1 service.");
	}
	
	getMultilevelSwitchState() {
		var value = Number(this.device.getProp(this.device.props.SwitchMultilevel));
		var state = value > 0;
	
		this.log(
			"Getting state for: %s and state is %s [%s]",
			this.accessory.displayName,
			state,
			typeof state
		);

		return state;
	}
	
	setMultilevelSwitchState(state) {
		this.log("Setting state [%s] to: %s [%s]", this.accessory.displayName, state, typeof state);
	
		var value;
		if (state) {
			value = this.device._CachedMultilevelSwitchValue;
		} else {
			value = '0';
			this.device._CachedMultilevelSwitchValue = this.device.getProp(this.device.props.SwitchMultilevel);
		}
	
		this.device.setProp(this.device.props.SwitchMultilevel, value, function() {});
	}
	
	getMultilevelSwitchValue() {
		var value = Number(this.device.getProp(this.device.props.SwitchMultilevel));
		value = Math.round(value * 100 / 255);
	
		this.log(
			"Getting value for: %s and value is %s % [%s]",
			this.accessory.displayName,
			value,
			typeof value
		);

		return value;
	}
	
	setMultilevelSwitchValue(value) {
		this.log("Setting value [%s] to: %s - %s % [%s]", this.accessory.displayName, Math.round(value * 255 / 100), value, typeof value);
	
		this.device.setProp(this.device.props.SwitchMultilevel, Math.round(value * 255 / 100), function() {});
	}
}

class AlmondBinarySwitch extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device);

		this.log("+Service.Switch");
		let service = accessory.addService(Service.Switch, device.name);

		service.getCharacteristic(Characteristic.On)
			.on('get', (callback) => {
				callback(null, this.getSwitchState());
			})
			.on('set', (value, callback) => {
				callback(null);
				this.setSwitchState(value);
			});

		this.log("Found 1 service.");
	}
}

class AlmondMultiSwitch extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device);

		this.log("+Service.Switch");
		let service = accessory.addService(Service.Switch, device.name);

		service.getCharacteristic(Characteristic.On)
			.on('get', (callback) => {
				callback(null, this.getSwitchState());
			})
			.on('set', (value, callback) => {
				callback(null);
				this.setSwitchState(value);
			});

		this.log("+Service.Switch");
		service = accessory.addService(Service.Switch, device.name + " Switch 2");

		service.getCharacteristic(Characteristic.On)
			.on('get', (callback) => {
				callback(null, this.getSwitchState2());
			})
			.on('set', (value, callback) => {
				callback(null);
				this.setSwitchState2(value);
			});

		this.log("Found 2 services.");
	}
}

class Almondz extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device);


	}
}
