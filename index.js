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

	buildAlmondAccessory(accessory, device) {
		let almondAccessory;
		switch (device.type) {
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

		return almondAccessory;
	}

	addAccessory(device) {
		let platform = this;
		this.log("Got device. Name: %s, ID: %s, Type: %s", device.name, device.id, device.type)
	
		if (device.props === undefined) {
			this.log("Device not supported.");
			return;
		}

		let accessory;
		const uuid = UUIDGen.generate('AlmondDevice: '.concat(device.id));	
		const existingAccessory = this.accessories[uuid];

		if (existingAccessory === undefined) {
			accessory = new Accessory(device.name, uuid);
		} else {
			accessory = existingAccessory;
		}

		const almondAccessory = this.buildAlmondAccessory(accessory, device);

		if (almondAccessory === undefined) {
			this.log("No services supported: %s [%s]", device.name, device.type);
			return;
		}

		if (existingAccessory === undefined) {
			this.api.registerPlatformAccessories("homebridge-platform-almond", "Almond", [accessory]);
		}
	
		this.accessories[uuid] = almondAccessory;
	}
	
	configureAccessory(accessory) {
		this.log("Configuring Accessory from cache: %s [%s]", accessory.UUID, accessory.displayName);
		accessory.updateReachability(true);
		this.accessories[accessory.UUID] = accessory;
	}
	
	_pruneAccessories() {
		// After we have got all the devices from the Almond, check to see if we have any dead
		// cached devices and kill them.
		let accessory;
		for (let key in this.accessories) {
			accessory = this.accessories[key];
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

	acquireService(service, name) {
		const existingService = this.accessory.getService(service);
		if (existingService === undefined) {
			return this.accessory.addService(service, name);
		} else {
			return existingService;
		}
	}

	acquireCharacteristic(service, characteristic) {
		const existingCharacteristic = service.getCharacteristic(characteristic);
		if (existingCharacteristic === undefined) {
			return service.addCharacteristic(characteristic);
		} else {
			return existingCharacteristic;
		}
	}

	observeDevice(device) {
	}

	getSwitchState() {
		let state = this.device.getProp(this.device.props.SwitchBinary);
	
		this.log(
			"Getting state for: %s and state is %s [%s]",
			this.accessory.displayName,
			state,
			typeof state
		);

		return state;
	}

	getSwitchState2() {
		let state = this.device.getProp(this.device.props.SwitchBinary2);
	
		this.log(
			"Getting state for: %s and state is %s [%s]",
			this.accessory.displayName,
			state,
			typeof state
		);

		return state;
	}

	getBrightness() {
		let brightness = this.device.getProp(this.device.props.SwitchMultilevel);
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
		let state = this.device.getProp(this.device.props.State);

		this.log(
			"Getting state for: %s and state is %s [%s]",
			this.accessory.displayName,
			state,
			typeof state
		);

		return state;
	}

	getTamperState() {
		let state = this.device.getProp(this.device.props.Tamper);

		this.log(
			"Getting tamper state for: %s and state is %s [%s]",
			this.accessory.displayName,
			state,
			typeof state
		);

		return state;
	}

	getLowBatteryState() {
		let state = this.device.getProp(this.device.props.LowBattery);

		this.log(
			"Getting LowBattery state for: %s and state is %s [%s]",
			this.accessory.displayName,
			state,
			typeof state
		);

		return state;
	}

	setSwitchState(state) {
		this.log(
			"Setting switch [%s] to: %s [%s]",
			this.accessory.displayName,
			state,
			typeof state
		);
	
		this.device.setProp(this.device.props.SwitchBinary, state);
	}

	setSwitchState2(state) {
		this.log(
			"Setting switch [%s] to: %s [%s]",
			this.accessory.displayName,
			state,
			typeof state
		);
	
		this.device.setProp(this.device.props.SwitchBinary2, state);
	}
	
	setBrightness(state) {
		this.log(
			"Setting brightness [%s] to: %s - %s % [%s]",
			this.accessory.displayName,
			Math.round(state * 255 / 100),
			state,
			typeof state
		);
	
		this.device.setProp(this.device.props.SwitchMultilevel, Math.round(state * 255 / 100));
	}
	
	updateBoolState(value, prop) {	
		prop = parseInt(prop);
		let service;
	
		if (this.device.type == this.device.props.MultilevelSwitchOnOff) {
			this.log(
				"Updating Lightbulb state to: %s [%s]",
				value,
				typeof value
			);

			this.accessory.getService(Service.Lightbulb)
				.getCharacteristic(Characteristic.On)
				.updateValue(value);
		} else if (this.device.type == this.device.props.FireSensor) {
			service = this.accessory.getService(Service.SmokeSensor);
			switch (prop) {
				case this.device.props.State:
					this.log(
						"Updating SmokeSensor state to: %s [%s]",
						value,
						typeof value
					);

					service.getCharacteristic(Characteristic.SmokeDetected)
						.updateValue(value ? Characteristic.SmokeDetected.SMOKE_DETECTED : Characteristic.SmokeDetected.SMOKE_NOT_DETECTED);
					break;
				case this.device.props.Tamper:
					this.log(
						"Updating SmokeSensor tampered to: %s [%s]",
						value,
						typeof value
						);

					service.getCharacteristic(Characteristic.StatusTampered)
						.updateValue(value ? Characteristic.StatusTampered.TAMPERED : Characteristic.StatusTampered.NOT_TAMPERED);
					break;
				case this.device.props.LowBattery:
					this.log(
						"Updating SmokeSensor low battery to: %s [%s]",
						value,
						typeof value
					);
					
					service.getCharacteristic(Characteristic.StatusLowBattery)
						.updateValue(value ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
					break;
			}
		} else if (this.device.type == this.device.props.ContactSwitch) {
			service = this.accessory.getService(Service.ContactSensor);
			switch (prop) {
				case this.device.props.State:
					this.log(
						"Updating ContactSensor state to: %s [%s]",
						value,
						typeof value
					);

					service.getCharacteristic(Characteristic.ContactSensorState)
						.updateValue(value ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED : Characteristic.ContactSensorState.CONTACT_DETECTED);
					break;
				case this.device.props.Tamper:
					this.log(
						"Updating ContactSensor tampered to: %s [%s]",
						value,
						typeof value
					);

					service.getCharacteristic(Characteristic.StatusTampered)
						.updateValue(value ? Characteristic.StatusTampered.TAMPERED : Characteristic.StatusTampered.NOT_TAMPERED);
					break;
				case this.device.props.LowBattery:
					this.log(
						"Updating ContactSensor low battery to: %s [%s]",
						value,
						typeof value
					);

					service.getCharacteristic(Characteristic.StatusLowBattery)
						.updateValue(value ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
			}
			//test for temperature service
		} else {
			this.log(
				"Updating Switch State to: %s [%s]",
				value,
				typeof value
			);

			this.accessory.getService(Service.Switch)
				.getCharacteristic(Characteristic.On)
				.updateValue(value);
		}
	}
	
	updateBrightnessState(value) {
		this.log(
			"Updating Brightness State to: %s [%s]",
			value,
			typeof value
		);
	
		this.accessory.getService(Service.Lightbulb)
			.getCharacteristic(Characteristic.Brightness)
			.updateValue(value);
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
			this.updateBoolState(value, prop);
		}
	
		if (this.props.SwitchMultilevel == prop) {
			value = Math.round(value * 100 / 255);
			self.updateBrightnessState(value);
		}
	}	
}

// Almond+ accessory classes

class AlmondMultilevelSwitch extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device);

		this.log("+Service.Lightbulb (MultilevelSwitch)");
		let service = this.acquireService(Service.Lightbulb, device.name);

		service.getCharacteristic(Characteristic.On)
			.on('get', (callback) => {
				callback(null, this.getMultilevelSwitchState());
			})
			.on('set', (value, callback) => {
				callback(null);
				this.setMultilevelSwitchState(value);
			});

		this.acquireCharacteristic(service, Characteristic.Brightness)
			.on('get', (callback) => {
				callback(null, this.getMultilevelSwitchValue());
			})
			.on('set', (value, callback) => {
				callback(null);
				this.setMultilevelSwitchValue(value);
			});

			this.device.on('valueUpdated', (property, value) => {
				switch (Number(property)) {
					case deviceProperty.SwitchMultilevel:
						this.updateMultilevelSwitch(value);
				}
			});

		this.log("Found 1 service.");
	}

	updateMultilevelSwitch(value) {
		this.log(
			"Updating value for: %s and value is %s [%s]",
			this.accessory.displayName,
			value,
			typeof value
		);

		let service = this.accessory.getService(Service.Lightbulb);
		if (value == 0) {
			service.getCharacteristic(Characteristic.On).updateValue(false);
		} else if (value > 0 && value <= 100) {
			service.getCharacteristic(Characteristic.Brightness).updateValue(value);
//			if (service.getCharacteristic(Characteristic.On).getValue() === false) {
//				service.getCharacteristic(Characteristic.On).setValue(true);
//			}
		}
	}

	getMultilevelSwitchState() {
		let value = this.device.getProp(this.device.props.SwitchMultilevel);
		let state = value > 0;
	
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
	
		let value;
		if (state) {
			value = this.device._CachedMultilevelSwitchValue;
		} else {
			value = 0;
			this.device._CachedMultilevelSwitchValue = this.device.getProp(this.device.props.SwitchMultilevel);
		}

		this.device.setProp(this.device.props.SwitchMultilevel, value);
	}

	getMultilevelSwitchValue() {
		let value = this.device.getProp(this.device.props.SwitchMultilevel);
	
		this.log(
			"Getting value for: %s and value is %s % [%s]",
			this.accessory.displayName,
			value,
			typeof value
		);

		return value;
	}
	
	setMultilevelSwitchValue(value) {
		this.log(
			"Setting value [%s] to: %s % [%s]",
			this.accessory.displayName,
			value,
			typeof value
		);
	
		this.device.setProp(this.device.props.SwitchMultilevel, value);
	}
}

class AlmondMultilevelSwitchOnOff extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device);

		this.log("+Service.Lightbulb");
		let service = this.acquireService(Service.Lightbulb, device.name);

		service.getCharacteristic(Characteristic.On)
			.on('get', (callback) => {
				callback(null, this.getSwitchState());
			})
			.on('set', (value, callback) => {
				callback(null);
				this.setSwitchState(value);
			});

		this.acquireCharacteristic(service, Characteristic.Brightness)
			.on('get', (callback) => {
				callback(null, this.getBrightness());
			})
			.on('set', (value, callback) => {
				callback(null);
				this.setBrightness(value);
			});

		this.log("Found 1 service.");
	}
}

class AlmondThermostat extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device);

		this.log("+Service.Thermostat");
		let service = this.acquireService(Service.Thermostat, device.name);

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

		this.acquireCharacteristic(service, Characteristic.CurrentRelativeHumidity)
			.on('get', (callback) => {
				callback(null, this.getCurrentRelativeHumidity());
			});

		this.acquireCharacteristic(service, Characteristic.CoolingThresholdTemperature)
			.on('get', (callback) => {
				callback(null, this.getCoolingThresholdTemperature());
			})
			.on('set', (value, callback) => {
				callback(null);
				this.setCoolingThresholdTemperature(value);
			});

		this.acquireCharacteristic(service, Characteristic.HeatingThresholdTemperature)
			.on('get', (callback) => {
				callback(null, this.getHeatingThresholdTemperature());
			})
			.on('set', (value, callback) => {
				callback(null);
				this.setHeatingThresholdTemperature(value);
			});

		this.log("+Service.Fan");
		service = this.acquireService(Service.Fan, device.name + " Fan");

		service.getCharacteristic(Characteristic.On)
			.on('get', (callback) => {
				callback(null, this.getFanMode());
			})
			.on('set', (value, callback) => {
				callback(null);
				this.setFanMode(value);
			});

		this.device.on('valueUpdated', (property, value) => {
			switch (property) {
				case this.device.props.Temperature:
					this.updateCurrentTemperature(value);
					break;
				case this.device.props.Mode:
					this.updateTargetHeatingCoolingState(value);
					break;
				case this.device.props.OperatingState:
					this.updateCurrentHeatingCoolingState(value);
					break;
				case this.device.props.SetpointHeating:
					this.updateHeatingThresholdTemperature(value);
					break;
				case this.device.props.SetpointCooling:
					this.updateCoolingThresholdTemperature(value);
					break;
				case this.device.props.FanMode:
					this.updateFanMode(value);
					break;
				case this.device.props.Units:
					this.updateTemperatureDisplayUnits(value);
					break;
				case this.device.props.Humidity:
					this.updateCurrentRelativeHumidity(value);
			}
		});


		this.log("Found 2 services.");
	}

	toHomekitTemperature(temperature) { // Typically for values heading to HomeKit
		const units = this.device.getProp(this.device.props.Units);

		if (units == "F") {
			temperature = (temperature - 32) / 1.8;
		}
		temperature = Number(temperature.toFixed(1));

		return temperature;
	}

	toAlmondTemperature(temperature) { // Typically for values heading to Almond+
		const units = this.device.getProp(this.device.props.Units);

		if (units == "F") {
			temperature = temperature * 1.8 + 32;
			// Not sure if this 0.5-degree rounding is necessary
			temperature = Math.round(temperature * 2) / 2;
		}

		return temperature;
	}

	getCurrentHeatingCoolingState() {
		const state = this.device.getProp(this.device.props.OperatingState);

		const states = {
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

	updateCurrentHeatingCoolingState(state) {
		const states = {
			"Idle": Characteristic.CurrentHeatingCoolingState.OFF,
			"Heating": Characteristic.CurrentHeatingCoolingState.HEAT,
			"Cooling": Characteristic.CurrentHeatingCoolingState.COOL
		}
	
		this.log(
			"Updating operating state for: %s and state is %s [%s]",
			this.accessory.displayName,
			state,
			typeof state
		);

		this.accessory.getService(Service.Thermostat)
			.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
			.updateValue(states[state]);
	}

	getTargetHeatingCoolingState() {
		const state = this.device.getProp(this.device.props.Mode);
	
		const states = {
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
		this.log(
			"Setting operating mode [%s] to: %s [%s]",
			this.accessory.displayName,
			state,
			typeof state
		);
	
		const states = [];
		states[Characteristic.TargetHeatingCoolingState.OFF] = "Off";
		states[Characteristic.TargetHeatingCoolingState.HEAT] = "Heat";
		states[Characteristic.TargetHeatingCoolingState.COOL] = "Cool";
		states[Characteristic.TargetHeatingCoolingState.AUTO] = "Auto";
	
		this.device.setProp(this.device.props.Mode, states[state]);
	}

	updateTargetHeatingCoolingState(state) {
		this.log(
			"Updating operating mode for: %s and mode is %s [%s]",
			this.accessory.displayName,
			state,
			typeof state
		);

		const states = {
			"Off": Characteristic.TargetHeatingCoolingState.OFF,
			"Heat": Characteristic.TargetHeatingCoolingState.HEAT,
			"Cool": Characteristic.TargetHeatingCoolingState.COOL,
			"Auto": Characteristic.TargetHeatingCoolingState.AUTO
		}

/////////////////////////////////////////////////////////////////////// Update target temp as well

		this.accessory.getService(Service.Thermostat)
			.getCharacteristic(Characteristic.TargetHeatingCoolingState)
			.updateValue(states[state]);
	}

	getCurrentTemperature() {
		let temperature = this.device.getProp(this.device.props.Temperature);
		temperature = this.toHomekitTemperature(temperature);
	
		this.log(
			"Getting current temperature for: %s and temperature is %s degrees C [%s]",
			this.accessory.displayName,
			temperature,
			typeof temperature
		);

		return temperature;
	}
	
	updateCurrentTemperature(temperature) {
		temperature = this.toHomekitTemperature(temperature);

		this.log(
			"Updating current temperature for: %s and temperature is %s degrees C [%s]",
			this.accessory.displayName,
			temperature,
			typeof temperature
		);

		this.accessory.getService(Service.Thermostat)
			.getCharacteristic(Characteristic.CurrentTemperature)
			.updateValue(temperature);	
	}
	
	getTargetTemperature() {
		const mode = this.device.getProp(this.device.props.Mode);
		let targetTemperature = 0;
		if (mode == "Heat") {
			targetTemperature = this.device.getProp(this.device.props.SetpointHeating);
		} else if (mode == "Cool") {
			targetTemperature = this.device.getProp(this.device.props.SetpointCooling);
		} else if (mode == "Auto" || mode == "Off") {
			// This is bogus, but we have to give an answer
			const heatingTemperature = this.device.getProp(this.device.props.SetpointHeating);
			const coolingTemperature = this.device.getProp(this.device.props.SetpointCooling);
			targetTemperature = Number(((heatingTemperature + coolingTemperature) / 2).toFixed(1));
		}
		targetTemperature = this.toHomekitTemperature(targetTemperature);
	
		this.log(
			"Getting current target temperature for: %s and temperature is %s degrees C [%s]",
			this.accessory.displayName,
			targetTemperature,
			typeof targetTemperature
		);

		return targetTemperature;
	}
	
	setTargetTemperature(temperature) {
		this.log(
			"Setting target temperature [%s] to: %s degrees C [%s]",
			this.accessory.displayName,
			temperature,
			typeof temperature
		);

		let targetTemperature = this.toAlmondTemperature(temperature);	
		const mode = this.device.getProp(this.device.props.Mode);
		if (mode == "Heat") {
			this.device.setProp(this.device.props.SetpointHeating, targetTemperature);
		} else if (mode == "Cool") {
			this.device.setProp(this.device.props.SetpointCooling, targetTemperature);
		}
	}
	
	getTemperatureDisplayUnits() {
		const units = this.device.getProp(this.device.props.Units);
	
		const unitTypes = {
			"C": Characteristic.TemperatureDisplayUnits.CELSIUS,
			"F": Characteristic.TemperatureDisplayUnits.FAHRENHEIT
		}
	
		this.log(
			"Getting temperature display units for: %s and units are %s [%s]",
			this.accessory.displayName,
			unitTypes[units],
			typeof unitTypes[units]
		);

		return unitTypes[units];
	}
	
	setTemperatureDisplayUnits(units) {
		const unitTypes = [];
		unitTypes[Characteristic.TemperatureDisplayUnits.CELSIUS] = "C";
		unitTypes[Characteristic.TemperatureDisplayUnits.FAHRENHEIT] = "F";
	
		this.log(
			"Setting temperature display units [%s] to: %s [%s]",
			this.accessory.displayName,
			unitTypes[units],
			typeof unitTypes[units]
		);
	
		// Almond+ doesn't allow this to be set
		//this.device.setProp(this.device.props.Units, unitTypes[units]);
	}

	updateTemperatureDisplayUnits(units) {
		const unitTypes = {
			"C": Characteristic.TemperatureDisplayUnits.CELSIUS,
			"F": Characteristic.TemperatureDisplayUnits.FAHRENHEIT
		}
	
		this.log(
			"Updating temperature display units for: %s and units are %s [%s]",
			this.accessory.displayName,
			unitTypes[units],
			typeof unitTypes[units]
		);

		this.accessory.getService(Service.Thermostat)
			.getCharacteristic(Characteristic.TemperatureDisplayUnits)
			.updateValue(unitTypes[units]);
	}

	getCurrentRelativeHumidity() {
		let humidity = this.device.getProp(this.device.props.Humidity);
		humidity = Math.round(humidity);

		this.log(
			"Getting current relative humidity for: %s and humidity is %s % [%s]",
			this.accessory.displayName,
			humidity,
			typeof humidity
		);

		return humidity;
	}

	updateCurrentRelativeHumidity(humidity) {
		humidity = Math.round(humidity);

		this.log(
			"Updating current relative humidity for: %s and humidity is %s % [%s]",
			this.accessory.displayName,
			humidity,
			typeof humidity
		);

		this.accessory.getService(Service.Thermostat)
			.getCharacteristic(Characteristic.CurrentRelativeHumidity)
			.updateValue(humidity);
	}

	getCoolingThresholdTemperature() {
		let coolingTemperature = this.device.getProp(this.device.props.SetpointCooling);
		coolingTemperature = this.toHomekitTemperature(coolingTemperature);
	
		this.log(
			"Getting current cooling temperature threshold for: %s and temperature is %s degrees C [%s]",
			this.accessory.displayName,
			coolingTemperature,
			typeof coolingTemperature
		);

		return coolingTemperature;
	}
	
	setCoolingThresholdTemperature(temperature) {
		this.log(
			"Setting cooling temperature threshold [%s] to: %s degrees C [%s]",
			this.accessory.displayName,
			temperature,
			typeof temperature
		);
	
		const mode = this.device.getProp(this.device.props.Mode);
		if (mode == "Auto") {
			// This property should only be set in Auto mode
			const coolingTemperature = this.toAlmondTemperature(temperature);
			this.device.setProp(this.device.props.SetpointCooling, coolingTemperature);
		}
	}
	
	updateCoolingThresholdTemperature(temperature) {
		const coolingTemperature = this.toHomekitTemperature(temperature);

		this.log(
			"Updating current cooling temperature threshold for: %s and temperature is %s degrees C [%s]",
			this.accessory.displayName,
			coolingTemperature,
			typeof coolingTemperature
		);

		const service = this.accessory.getService(Service.Thermostat);
		service.getCharacteristic(Characteristic.CoolingThresholdTemperature)
			.updateValue(coolingTemperature);

		const mode = this.device.getProp(this.device.props.Mode);
		if (mode == "Cool") {
			service.getCharacteristic(Characteristic.TargetTemperature)
				.updateValue(coolingTemperature);
		}
	}
	
	getHeatingThresholdTemperature() {
		let heatingTemperature = this.device.getProp(this.device.props.SetpointHeating);
		heatingTemperature = this.toHomekitTemperature(heatingTemperature);
	
		this.log(
			"Getting current heating temperature threshold for: %s and temperature is %s degrees C [%s]",
			this.accessory.displayName,
			heatingTemperature,
			typeof heatingTemperature
		);

		return heatingTemperature;
	}
	
	setHeatingThresholdTemperature(temperature) {
		this.log(
			"Setting heating temperature threshold [%s] to: %s degrees C [%s]",
			this.accessory.displayName,
			temperature,
			typeof temperature
		);
	
		const mode = this.device.getProp(this.device.props.Mode);
		if (mode == "Auto") {
			// This property should only be set in Auto mode
			const heatingTemperature = this.toAlmondTemperature(temperature);
			this.device.setProp(this.device.props.SetpointHeating, heatingTemperature);
		}
	}

	updateHeatingThresholdTemperature(temperature) {
		const heatingTemperature = this.toHomekitTemperature(temperature);

		this.log(
			"Updating current heating temperature threshold for: %s and temperature is %s degrees C [%s]",
			this.accessory.displayName,
			heatingTemperature,
			typeof heatingTemperature
		);

		const service = this.accessory.getService(Service.Thermostat);
		service.getCharacteristic(Characteristic.HeatingThresholdTemperature)
			.updateValue(heatingTemperature);

		const mode = this.device.getProp(this.device.props.Mode);
		if (mode == "Heat") {
			service.getCharacteristic(Characteristic.TargetTemperature)
				.updateValue(heatingTemperature);
		}
	}

	getFanMode() {
		const fanMode = this.device.getProp(this.device.props.FanMode);

		this.log(
			"Getting fan mode for: %s and mode is %s [%s]",
			this.accessory.displayName,
			fanMode,
			typeof fanMode
		);

		return fanMode == "On Low";
	}
	
	setFanMode(state) {
		this.log(
			"Setting thermostat fan mode [%s] to: %s [%s]",
			this.accessory.displayName,
			state,
			typeof state
		);
	
		this.device.setProp(this.device.props.FanMode, state ? "On Low" : "Auto Low");
	}

	updateFanMode(mode) {
		this.log(
			"Updating fan mode for: %s and mode is %s [%s]",
			this.accessory.displayName,
			mode,
			typeof mode
		);

		this.accessory.getService(Service.Fan)
			.getCharacteristic(Characteristic.On)
			.updateValue(mode == "On Low");
	}
}

class AlmondContactSwitch extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device);

		this.log("+Service.ContactSensor");
		let service = this.acquireService(Service.ContactSensor, device.name);

		service.getCharacteristic(Characteristic.ContactSensorState)
			.on('get', (callback) => {
				callback(null, this.getStateState());
			});

		this.acquireCharacteristic(service, Characteristic.StatusTampered)
			.on('get', (callback) => {
				callback(null, this.getTamperState());
			});

		this.acquireCharacteristic(service, Characteristic.StatusLowBattery)
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
		let service = this.acquireService(Service.SmokeSensor, device.name);

		service.getCharacteristic(Characteristic.SmokeDetected)
			.on('get', (callback) => {
				callback(null, this.getStateState());
			});

		this.acquireCharacteristic(service, Characteristic.StatusTampered)
			.on('get', (callback) => {
				callback(null, this.getTamperState());
			});

		this.acquireCharacteristic(service, Characteristic.StatusLowBattery)
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
		let service = this.acquireService(Service.SmokeSensor, device.name);

		service.getCharacteristic(Characteristic.SmokeDetected)
			.on('get', (callback) => {
				callback(null, this.getSmokeDetectorStateState());
			});

		this.acquireCharacteristic(service, Characteristic.StatusLowBattery)
			.on('get', (callback) => {
				callback(null, this.getSmokeDetectorLowBatteryState());
			});

		this.log("Found 1 service.");
	}
	
	getSmokeDetectorStateState() {
		let state = this.device.getProp(this.device.props.Status) > 0;
		state = Number(state);

		const states = [
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
		let state = this.device.getProp(this.device.props.Battery) <= 20;
		state = Number(state);
	
		const states = [
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
		let service = this.acquireService(Service.GarageDoorOpener, device.name);

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
		const states = {
			0: Characteristic.CurrentDoorState.CLOSED,
			252: Characteristic.CurrentDoorState.CLOSING,
			253: Characteristic.CurrentDoorState.STOPPED,
			254: Characteristic.CurrentDoorState.OPENING,
			255: Characteristic.CurrentDoorState.OPEN
		}

		let state = this.device.getProp(this.device.props.BarrierOperator);

		this.log(
			"Getting current door state for: %s and state is %s [%s]",
			this.accessory.displayName,
			states[state],
			typeof states[state]
		);

		return states[state];
	}
	
	getTargetDoorState() {
		let targetState;
		if (this.device._targetDoorState !== undefined) {
			targetState = this.device._targetDoorState;
		} else {
			const currentState = this.device.getProp(this.device.props.BarrierOperator);
			if (currentState == 0 || currentState == 252) {
				targetState = Characteristic.TargetDoorState.CLOSED;
			} else if (currentState == 255 || currentState == 254) {
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
	
		const states = [];
		states[Characteristic.TargetDoorState.OPEN] = 255;
		states[Characteristic.TargetDoorState.CLOSED] = 0;	
	
		this.device.setProp(this.device.props.BarrierOperator, states[state]);
	}
	
	getObstructionDetected() {
		let obstruction = this.device.getProp(this.device.props.BarrierOperator) == 253;
	
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
		let service = this.acquireService(Service.Fan, device.name);

		service.getCharacteristic(Characteristic.On)
			.on('get', (callback) => {
				callback(null, this.getMultilevelSwitchState());
			})
			.on('set', (value, callback) => {
				callback(null);
				this.setMultilevelSwitchState(value);
			});

		this.acquireCharacteristic(service, Characteristic.RotationSpeed)
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
		let state = this.device.getProp(this.device.props.SwitchMultilevel) > 0;
	
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
	
		let value;
		if (state) {
			value = this.device._CachedMultilevelSwitchValue;
		} else {
			value = 0;
			this.device._CachedMultilevelSwitchValue = this.device.getProp(this.device.props.SwitchMultilevel);
		}
	
		this.device.setProp(this.device.props.SwitchMultilevel, value);
	}
	
	getMultilevelSwitchValue() {
		let value = this.device.getProp(this.device.props.SwitchMultilevel);
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
		this.log(
			"Setting value [%s] to: %s - %s % [%s]",
			this.accessory.displayName,
			Math.round(value * 255 / 100),
			value,
			typeof value
		);
	
		this.device.setProp(this.device.props.SwitchMultilevel, Math.round(value * 255 / 100));
	}
}

class AlmondBinarySwitch extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device);

		this.log("+Service.Switch");
		let service = this.acquireService(Service.Switch, device.name);

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
		let service = this.acquireService(Service.Switch, device.name);

		service.getCharacteristic(Characteristic.On)
			.on('get', (callback) => {
				callback(null, this.getSwitchState());
			})
			.on('set', (value, callback) => {
				callback(null);
				this.setSwitchState(value);
			});

		this.log("+Service.Switch");
		service = this.acquireService(Service.Switch, device.name + " Switch 2");

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
