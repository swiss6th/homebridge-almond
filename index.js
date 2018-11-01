"use strict"

const Almond = require('almond-client'),
	deviceType = require('almond-client/deviceTypes'),
	deviceProperty = require('almond-client/deviceProperties'),
	debug = require('debug')('homebridge-platform-almond')

let Accessory,
	Characteristic,
	Service,
	UUIDGen

module.exports = function(homebridge) {
	Accessory = homebridge.platformAccessory
	Characteristic = homebridge.hap.Characteristic
	Service = homebridge.hap.Service
	UUIDGen = homebridge.hap.uuid

	homebridge.registerPlatform("homebridge-almond", "Almond", AlmondPlatform, true)
}

class AlmondPlatform {
	constructor(log, config, api) {
		this.log = log
		this.config = config
		this.api = api
	
		this.accessories = []
	
		this.log("Starting up, config: ", config)
	
		this.api.on('didFinishLaunching', () => {
			this.client = new Almond(this.config)

			this.client.on("ready", () => {
				this.client.getDevices().forEach(this.addAccessory, this)
				this._pruneAccessories()
			})
		})
	}

	buildAlmondAccessory(accessory, device) {
		let almondAccessory
		switch (device.type) {
			case deviceType.MultilevelSwitch:
				almondAccessory = new AlmondMultilevelSwitch(this.log, accessory, device)
				break
			case deviceType.MultilevelSwitchOnOff:
				almondAccessory = new AlmondMultilevelSwitchOnOff(this.log, accessory, device)
				break
			case deviceType.Thermostat:
				almondAccessory = new AlmondThermostat(this.log, accessory, device)
				break
			case deviceType.ContactSwitch:
				almondAccessory = new AlmondContactSwitch(this.log, accessory, device)
				break
			case deviceType.FireSensor:
				almondAccessory = new AlmondFireSensor(this.log, accessory, device)
				break
			case deviceType.SmokeDetector:
				almondAccessory = new AlmondSmokeDetector(this.log, accessory, device)
				break
			case deviceType.GarageDoorOpener:
				almondAccessory = new AlmondGarageDoorOpener(this.log, accessory, device)
				break
			case deviceType.GenericPSM:
				if (
					device.manufacturer == "GE" &&
					device.model == "Unknown: type=4944,"
				) {
					// This is a GE continuous fan controller, which shows up as a siren in the Almond app
					almondAccessory = new AlmondGenericPsmFan(this.log, accessory, device)
				}
				break
			case deviceType.BinarySwitch:
				almondAccessory = new AlmondBinarySwitch(this.log, accessory, device)
				break
			default:
				if (device.props.SwitchBinary !== undefined) {
					// Fallback to Switch
					almondAccessory = new AlmondBinarySwitch(this.log, accessory, device)
				}
		}

		return almondAccessory
	}

	addAccessory(device) {
		let platform = this
		this.log("Got device. Name: %s, ID: %s, Type: %s", device.name, device.id, device.type)
	
		if (device.props === undefined) {
			this.log("Device not supported.")
			return
		}

		const uuid = UUIDGen.generate('AlmondDevice: '.concat(device.id))
		const existingAccessory = this.accessories[uuid]
		let accessory

		if (existingAccessory === undefined) {
			accessory = new Accessory(device.name, uuid)
		} else {
			accessory = existingAccessory
		}

		const almondAccessory = this.buildAlmondAccessory(accessory, device)

		if (almondAccessory === undefined) {
			this.log("No services supported: %s [%s]", device.name, device.type)
			return
		}

		if (existingAccessory === undefined) {
			this.api.registerPlatformAccessories("homebridge-platform-almond", "Almond", [accessory])
		}
	
		this.accessories[uuid] = almondAccessory
	}
	
	configureAccessory(accessory) {
		this.log("Configuring Accessory from cache: %s [%s]", accessory.UUID, accessory.displayName)
		accessory.updateReachability(true)
		this.accessories[accessory.UUID] = accessory
	}
	
	_pruneAccessories() {
		// After we have got all the devices from the Almond, check to see if we have any dead
		// cached devices and kill them.
		let accessory
		for (let key in this.accessories) {
			accessory = this.accessories[key]
			this.log("Checking existance of %s:", accessory.displayName)
			if (!(accessory instanceof AlmondAccessory)) {
				this.log("(-) Did not find device for accessory %s. Removing it.", accessory.displayName)
				this.api.unregisterPlatformAccessories("homebridge-platform-almond", "Almond", [accessory])
				delete this.accessories[key]
			} else {
				this.log("(+) Device exists.")
			}
		}
	}
}

// Foundation class for all Almond+ accessories

class AlmondAccessory {
	constructor(log, accessory, device) {
		this.accessory = accessory
		this.device = device
		this.log = log
		this.displayName = this.accessory.displayName
	
		this.log("Setting up %s...", accessory.displayName)

		this.updateReachability(true)
	
		this.accessory.getService(Service.AccessoryInformation)
			.setCharacteristic(Characteristic.Manufacturer, device.manufacturer)
			.setCharacteristic(Characteristic.Model, device.model)
	
		this.accessory.on('identify', function(paired, callback) {
			self.log("%s identified", self.accessory.displayName)
			//removed since not all devices are switch.
			//ToDo - Add support for all suported accesories
			//self.getSwitchState(function(err, state) {
			//    self.setSwitchState(!state)
			callback()
			//})
		})
	
		this.observeDevice(device)
	}

	acquireService(service, name) {
		const existingService = this.accessory.getService(service)
		if (existingService === undefined) {
			return this.accessory.addService(service, name)
		} else {
			return existingService
		}
	}

	acquireCharacteristic(service, characteristic) {
		const existingCharacteristic = service.getCharacteristic(characteristic)
		if (existingCharacteristic === undefined) {
			return service.addCharacteristic(characteristic)
		} else {
			return existingCharacteristic
		}
	}

	addUpdateListener(listener) {
		this.device.addUpdateListener(listener)
	}

	updateReachability(reachable) {
		this.accessory.updateReachability(reachable)
	}

	observeDevice(device) {
	}
}

// Almond+ accessory classes

class AlmondMultilevelSwitch extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device)

		// Set default brightness for when it can't be determined
		this._DEFAULT_BRIGHTNESS = 100
		this._cachedBrightness = this._DEFAULT_BRIGHTNESS

		this.log("+Service.Lightbulb (MultilevelSwitch)")
		let service = this.acquireService(Service.Lightbulb, device.name)

		service.getCharacteristic(Characteristic.On)
			.on('get', (callback) => {
				callback(null, this.getState())
			})
			.on('set', (value, callback) => {
				callback(null)
				this.setState(value)
			})

		this.acquireCharacteristic(service, Characteristic.Brightness)
			.on('get', (callback) => {
				callback(null, this.getBrightness())
			})
			.on('set', (value, callback) => {
				callback(null)
				this.setBrightness(value)
			})

		this.addUpdateListener( (property, value) => {
			console.log("Responding to valueUpdated for", this.accessory.displayName) //////////////////////////////////////////////////////////
			switch (property) {
				case this.device.props.SwitchMultilevel:
					this.updateSwitchMultilevel(value)
			}
		})

		this.log("Found 1 service.")
	}

	getState() {
		let value = this.device.getProp(this.device.props.SwitchMultilevel)
		let state = value > 0
	
		this.log(
			"Getting state for %s... %s [%s]",
			this.accessory.displayName,
			state,
			typeof state
		)

		return state
	}
	
	setState(state) {
		this.log(
			"Setting state for %s to %s [%s]",
			this.accessory.displayName,
			state,
			typeof state
		)
	
		const oldBrightness = this.device.getProp(this.device.props.SwitchMultilevel)
		if (oldBrightness > 0 && oldBrightness <= 100) {
			this._cachedBrightness = oldBrightness
		}

		let newBrightness
		if (state) {
			if (this._cachedBrightness === undefined) {
				newBrightness = this._DEFAULT_BRIGHTNESS
				this._cachedBrightness == newBrightness
			} else {
				newBrightness = this._cachedBrightness
			}
		} else {
			newBrightness = 0
		}

		this.device.setProp(this.device.props.SwitchMultilevel, newBrightness)
	}

	getBrightness() {
		let brightness = this.device.getProp(this.device.props.SwitchMultilevel)

		this.log(
			"Getting brightness for %s... %s% [%s]",
			this.accessory.displayName,
			brightness,
			typeof brightness
		)

		return brightness
	}
	
	setBrightness(brightness) {
		this.log(
			"Setting brightness for %s to %s% [%s]",
			this.accessory.displayName,
			brightness,
			typeof brightness
		)

		if (brightness > 0 && brightness <= 100) {
			this._cachedBrightness = brightness
		}

		this.device.setProp(this.device.props.SwitchMultilevel, brightness)
	}

	updateSwitchMultilevel(brightness) {
		this.log(
			"Updating brightness for %s to %s% [%s]",
			this.accessory.displayName,
			brightness,
			typeof brightness
		)

		let service = this.accessory.getService(Service.Lightbulb)
		if (brightness == 0) {
			service.getCharacteristic(Characteristic.On)
				.updateValue(false)
		} else if (brightness > 0 && brightness <= 100) {
			this._cachedBrightness = brightness
			service.getCharacteristic(Characteristic.Brightness)
				.updateValue(brightness)
			service.getCharacteristic(Characteristic.On)
				.updateValue(true)
		}
	}
}

class AlmondMultilevelSwitchOnOff extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device)

		this.log("+Service.Lightbulb")
		let service = this.acquireService(Service.Lightbulb, device.name)

		service.getCharacteristic(Characteristic.On)
			.on('get', (callback) => {
				callback(null, this.getState())
			})
			.on('set', (value, callback) => {
				callback(null)
				this.setState(value)
			})

		this.acquireCharacteristic(service, Characteristic.Brightness)
			.on('get', (callback) => {
				callback(null, this.getBrightness())
			})
			.on('set', (value, callback) => {
				callback(null)
				this.setBrightness(value)
			})

		this.addUpdateListener( (property, value) => {
			switch (property) {
				case this.device.props.SwitchBinary:
					this.updateSwitchBinary(value)
					break
				case this.device.props.SwitchMultilevel:
					this.updateSwitchMultilevel(value)
			}
		})

		this.log("Found 1 service.")
	}

	getState() {
		let state = this.device.getProp(this.device.props.SwitchBinary)
	
		this.log(
			"Getting state for %s... %s [%s]",
			this.accessory.displayName,
			state,
			typeof state
		)

		return state
	}
	
	setState(state) {
		this.log(
			"Setting state for %s to %s [%s]",
			this.accessory.displayName,
			state,
			typeof state
		)
	
		this.device.setProp(this.device.props.SwitchBinary, state)
	}

	getBrightness() {
		let brightness = this.device.getProp(this.device.props.SwitchMultilevel)
		brightness = Math.round(brightness / 255 * 100)
	
		this.log(
			"Getting brightness for %s... %s% [%s]",
			this.accessory.displayName,
			brightness,
			typeof brightness
		)

		return brightness
	}

	setBrightness(brightness) {
		this.log(
			"Setting brightness for %s to %s% [%s]",
			this.accessory.displayName,
			brightness,
			typeof brightness
		)

		this.device.setProp(this.device.props.SwitchMultilevel, Math.round(brightness / 100 * 255))
	}

	updateSwitchBinary(state) {
		this.log(
			"Updating state for %s to %s [%s]",
			this.accessory.displayName,
			state,
			typeof state
		)

		this.accessory.getService(Service.Lightbulb)
			.getCharacteristic(Characteristic.On)
			.updateValue(state)
	}

	updateSwitchMultilevel(brightness) {
		const newBrightness = Math.round(brightness / 255 * 100)

		this.log(
			"Updating brightness for %s to %s% [%s]",
			this.accessory.displayName,
			newBrightness,
			typeof newBrightness
		)

		let service = this.accessory.getService(Service.Lightbulb)
//		if (brightness == 0) {
//			service.getCharacteristic(Characteristic.On)
//				.updateValue(false)
//		} else if (value > 0 && value <= 100) {
//			this._cachedBrightness = value
			service.getCharacteristic(Characteristic.Brightness)
				.updateValue(newBrightness)
//			service.getCharacteristic(Characteristic.On)
//				.updateValue(true)
//		}
	}
}

class AlmondThermostat extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device)

		this.log("+Service.Thermostat")
		let service = this.acquireService(Service.Thermostat, device.name)

		service.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
			.on('get', (callback) => {
				callback(null, this.getCurrentHeatingCoolingState())
			})

		service.getCharacteristic(Characteristic.TargetHeatingCoolingState)
			.on('get', (callback) => {
				callback(null, this.getTargetHeatingCoolingState())
			})
			.on('set', (value, callback) => {
				callback(null)
				this.setTargetHeatingCoolingState(value)
			})

		service.getCharacteristic(Characteristic.CurrentTemperature)
			.on('get', (callback) => {
				callback(null, this.getCurrentTemperature())
			})

		service.getCharacteristic(Characteristic.TargetTemperature)
			.on('get', (callback) => {
				callback(null, this.getTargetTemperature())
			})
			.on('set', (value, callback) => {
				callback(null)
				this.setTargetTemperature(value)
			})

		service.getCharacteristic(Characteristic.TemperatureDisplayUnits)
			.on('get', (callback) => {
				callback(null, this.getTemperatureDisplayUnits())
			})
			.on('set', (value, callback) => {
				callback(null)
				this.setTemperatureDisplayUnits(value)
			})

		this.acquireCharacteristic(service, Characteristic.CurrentRelativeHumidity)
			.on('get', (callback) => {
				callback(null, this.getCurrentRelativeHumidity())
			})

		this.acquireCharacteristic(service, Characteristic.CoolingThresholdTemperature)
			.on('get', (callback) => {
				callback(null, this.getCoolingThresholdTemperature())
			})
			.on('set', (value, callback) => {
				callback(null)
				this.setCoolingThresholdTemperature(value)
			})

		this.acquireCharacteristic(service, Characteristic.HeatingThresholdTemperature)
			.on('get', (callback) => {
				callback(null, this.getHeatingThresholdTemperature())
			})
			.on('set', (value, callback) => {
				callback(null)
				this.setHeatingThresholdTemperature(value)
			})

		this.log("+Service.Fan")
		service = this.acquireService(Service.Fan, device.name + " Fan")

		service.getCharacteristic(Characteristic.On)
			.on('get', (callback) => {
				callback(null, this.getFanMode())
			})
			.on('set', (value, callback) => {
				callback(null)
				this.setFanMode(value)
			})

		this.addUpdateListener( (property, value) => {
			switch (property) {
				case this.device.props.Temperature:
					this.updateCurrentTemperature(value)
					break
				case this.device.props.Mode:
					this.updateTargetHeatingCoolingState(value)
					break
				case this.device.props.OperatingState:
					this.updateCurrentHeatingCoolingState(value)
					break
				case this.device.props.SetpointHeating:
					this.updateHeatingThresholdTemperature(value)
					break
				case this.device.props.SetpointCooling:
					this.updateCoolingThresholdTemperature(value)
					break
				case this.device.props.FanMode:
					this.updateFanMode(value)
					break
				case this.device.props.Units:
					this.updateTemperatureDisplayUnits(value)
					break
				case this.device.props.Humidity:
					this.updateCurrentRelativeHumidity(value)
			}
		})

		this.log("Found 2 services.")
	}

	toHomekitTemperature(temperature) { // Typically for values heading to HomeKit
		const units = this.device.getProp(this.device.props.Units)

		if (units == "F") {
			temperature = (temperature - 32) / 1.8
		}
		temperature = Number(temperature.toFixed(1))

		return temperature
	}

	toAlmondTemperature(temperature) { // Typically for values heading to Almond+
		const units = this.device.getProp(this.device.props.Units)

		if (units == "F") {
			temperature = Math.round(temperature * 1.8 + 32)
		}

		return temperature
	}

	getCurrentHeatingCoolingState() {
		const state = this.device.getProp(this.device.props.OperatingState)

		const states = {
			"Idle": Characteristic.CurrentHeatingCoolingState.OFF,
			"Heating": Characteristic.CurrentHeatingCoolingState.HEAT,
			"Cooling": Characteristic.CurrentHeatingCoolingState.COOL
		}
	
		this.log(
			"Getting current operating state for %s... %s [%s]",
			this.accessory.displayName,
			state,
			typeof state
		)

		return states[state]
	}

	updateCurrentHeatingCoolingState(state) {
		const states = {
			"Idle": Characteristic.CurrentHeatingCoolingState.OFF,
			"Heating": Characteristic.CurrentHeatingCoolingState.HEAT,
			"Cooling": Characteristic.CurrentHeatingCoolingState.COOL
		}
	
		this.log(
			"Updating current operating state for %s to %s [%s]",
			this.accessory.displayName,
			state,
			typeof state
		)

		this.accessory.getService(Service.Thermostat)
			.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
			.updateValue(states[state])
	}

	getTargetHeatingCoolingState() {
		const state = this.device.getProp(this.device.props.Mode)
	
		const states = {
			"Off": Characteristic.TargetHeatingCoolingState.OFF,
			"Heat": Characteristic.TargetHeatingCoolingState.HEAT,
			"Cool": Characteristic.TargetHeatingCoolingState.COOL,
			"Auto": Characteristic.TargetHeatingCoolingState.AUTO
		}
	
		this.log(
			"Getting target operating mode for %s... %s [%s]",
			this.accessory.displayName,
			state,
			typeof state
		)

		return states[state]
	}

	setTargetHeatingCoolingState(state) {
		this.log(
			"Setting target operating mode for %s to %s [%s]",
			this.accessory.displayName,
			state,
			typeof state
		)

		const states = []
		states[Characteristic.TargetHeatingCoolingState.OFF] = "Off"
		states[Characteristic.TargetHeatingCoolingState.HEAT] = "Heat"
		states[Characteristic.TargetHeatingCoolingState.COOL] = "Cool"
		states[Characteristic.TargetHeatingCoolingState.AUTO] = "Auto"

		this.device.setProp(this.device.props.Mode, states[state])

		// This logic is based on this.getTargetTemperature().
		// It is repeated here in order to provide an immediate update to HomeKit.
		const mode = states[state]
		let targetTemperature = 0
		if (mode == "Heat") {
			targetTemperature = this.device.getProp(this.device.props.SetpointHeating)
		} else if (mode == "Cool") {
			targetTemperature = this.device.getProp(this.device.props.SetpointCooling)
		} else if (mode == "Auto" || mode == "Off") {
			// This is bogus, but we have to give an answer
			const heatingTemperature = this.device.getProp(this.device.props.SetpointHeating)
			const coolingTemperature = this.device.getProp(this.device.props.SetpointCooling)
			targetTemperature = Number(((heatingTemperature + coolingTemperature) / 2).toFixed(1))
		}
		targetTemperature = this.toHomekitTemperature(targetTemperature)

		this.accessory.getService(Service.Thermostat)
			.getCharacteristic(Characteristic.TargetTemperature)
			.updateValue(targetTemperature)
	}

	updateTargetHeatingCoolingState(state) {
		this.log(
			"Updating target operating mode for %s to %s [%s]",
			this.accessory.displayName,
			state,
			typeof state
		)

		const states = {
			"Off": Characteristic.TargetHeatingCoolingState.OFF,
			"Heat": Characteristic.TargetHeatingCoolingState.HEAT,
			"Cool": Characteristic.TargetHeatingCoolingState.COOL,
			"Auto": Characteristic.TargetHeatingCoolingState.AUTO
		}

		// This logic is based on this.getTargetTemperature().
		// It is repeated here in order to provide an immediate update to HomeKit.
		const mode = state
		let targetTemperature = 0
		if (mode == "Heat") {
			targetTemperature = this.device.getProp(this.device.props.SetpointHeating)
		} else if (mode == "Cool") {
			targetTemperature = this.device.getProp(this.device.props.SetpointCooling)
		} else if (mode == "Auto" || mode == "Off") {
			// This is bogus, but we have to give an answer
			const heatingTemperature = this.device.getProp(this.device.props.SetpointHeating)
			const coolingTemperature = this.device.getProp(this.device.props.SetpointCooling)
			targetTemperature = Number(((heatingTemperature + coolingTemperature) / 2).toFixed(1))
		}
		targetTemperature = this.toHomekitTemperature(targetTemperature)

		const service = this.accessory.getService(Service.Thermostat)
		service.getCharacteristic(Characteristic.TargetTemperature)
			.updateValue(targetTemperature)
		service.getCharacteristic(Characteristic.TargetHeatingCoolingState)
			.updateValue(states[state])
	}

	getCurrentTemperature() {
		let temperature = this.device.getProp(this.device.props.Temperature)
		temperature = this.toHomekitTemperature(temperature)
	
		this.log(
			"Getting current temperature for %s... %s degrees C [%s]",
			this.accessory.displayName,
			temperature,
			typeof temperature
		)

		return temperature
	}
	
	updateCurrentTemperature(temperature) {
		temperature = this.toHomekitTemperature(temperature)

		this.log(
			"Updating current temperature for %s to %s degrees C [%s]",
			this.accessory.displayName,
			temperature,
			typeof temperature
		)

		this.accessory.getService(Service.Thermostat)
			.getCharacteristic(Characteristic.CurrentTemperature)
			.updateValue(temperature)
	}
	
	getTargetTemperature() {
		const mode = this.device.getProp(this.device.props.Mode)
		let targetTemperature = 0
		if (mode == "Heat") {
			targetTemperature = this.device.getProp(this.device.props.SetpointHeating)
		} else if (mode == "Cool") {
			targetTemperature = this.device.getProp(this.device.props.SetpointCooling)
		} else if (mode == "Auto" || mode == "Off") {
			// This is bogus, but we have to give an answer
			const heatingTemperature = this.device.getProp(this.device.props.SetpointHeating)
			const coolingTemperature = this.device.getProp(this.device.props.SetpointCooling)
			targetTemperature = Number(((heatingTemperature + coolingTemperature) / 2).toFixed(1))
		}
		targetTemperature = this.toHomekitTemperature(targetTemperature)
	
		this.log(
			"Getting target temperature for %s... %s degrees C [%s]",
			this.accessory.displayName,
			targetTemperature,
			typeof targetTemperature
		)

		return targetTemperature
	}
	
	setTargetTemperature(temperature) {
		this.log(
			"Setting target temperature for %s to %s [%s]",
			this.accessory.displayName,
			temperature,
			typeof temperature
		)

		let targetTemperature = this.toAlmondTemperature(temperature)
		const mode = this.device.getProp(this.device.props.Mode)
		if (mode == "Heat") {
			this.device.setProp(this.device.props.SetpointHeating, targetTemperature)
		} else if (mode == "Cool") {
			this.device.setProp(this.device.props.SetpointCooling, targetTemperature)
		}
	}
	
	getTemperatureDisplayUnits() {
		const units = this.device.getProp(this.device.props.Units)
	
		const unitTypes = {
			"C": Characteristic.TemperatureDisplayUnits.CELSIUS,
			"F": Characteristic.TemperatureDisplayUnits.FAHRENHEIT
		}
	
		this.log(
			"Getting temperature display units for %s... degrees %s [%s]",
			this.accessory.displayName,
			unitTypes[units],
			typeof unitTypes[units]
		)

		return unitTypes[units]
	}

	setTemperatureDisplayUnits(units) {
		const unitTypes = []
		unitTypes[Characteristic.TemperatureDisplayUnits.CELSIUS] = "C"
		unitTypes[Characteristic.TemperatureDisplayUnits.FAHRENHEIT] = "F"

		this.log(
			"Setting temperature display units for %s to %s [%s]",
			this.accessory.displayName,
			unitTypes[units],
			typeof unitTypes[units]
		)
	
		// Almond+ doesn't allow this to be set
		//this.device.setProp(this.device.props.Units, unitTypes[units])
	}

	updateTemperatureDisplayUnits(units) {
		const unitTypes = {
			"C": Characteristic.TemperatureDisplayUnits.CELSIUS,
			"F": Characteristic.TemperatureDisplayUnits.FAHRENHEIT
		}
	
		this.log(
			"Updating temperature display units for %s to degrees %s [%s]",
			this.accessory.displayName,
			unitTypes[units],
			typeof unitTypes[units]
		)

		this.accessory.getService(Service.Thermostat)
			.getCharacteristic(Characteristic.TemperatureDisplayUnits)
			.updateValue(unitTypes[units])
	}

	getCurrentRelativeHumidity() {
		let humidity = this.device.getProp(this.device.props.Humidity)
		humidity = Math.round(humidity)

		this.log(
			"Getting current relative humidity for %s... %s% [%s]",
			this.accessory.displayName,
			humidity,
			typeof humidity
		)

		return humidity
	}

	updateCurrentRelativeHumidity(humidity) {
		humidity = Math.round(humidity)

		this.log(
			"Updating current relative humidity for %s to %s% [%s]",
			this.accessory.displayName,
			humidity,
			typeof humidity
		)

		this.accessory.getService(Service.Thermostat)
			.getCharacteristic(Characteristic.CurrentRelativeHumidity)
			.updateValue(humidity)
	}

	getCoolingThresholdTemperature() {
		let coolingTemperature = this.device.getProp(this.device.props.SetpointCooling)
		coolingTemperature = this.toHomekitTemperature(coolingTemperature)
	
		this.log(
			"Getting cooling threshold temperature for %s... %s degrees C [%s]",
			this.accessory.displayName,
			coolingTemperature,
			typeof coolingTemperature
		)

		return coolingTemperature
	}
	
	setCoolingThresholdTemperature(temperature) {
		this.log(
			"Setting cooling threshold temperature for %s to %s degrees C [%s]",
			this.accessory.displayName,
			temperature,
			typeof temperature
		)
	
		const mode = this.device.getProp(this.device.props.Mode)
		if (mode == "Auto") {
			// This property should only be set in Auto mode
			const coolingTemperature = this.toAlmondTemperature(temperature)
			this.device.setProp(this.device.props.SetpointCooling, coolingTemperature)
		}
	}
	
	updateCoolingThresholdTemperature(temperature) {
		const coolingTemperature = this.toHomekitTemperature(temperature)

		this.log(
			"Updating cooling threshold temperature for %s to %s degrees C [%s]",
			this.accessory.displayName,
			coolingTemperature,
			typeof coolingTemperature
		)

		const service = this.accessory.getService(Service.Thermostat)
		service.getCharacteristic(Characteristic.CoolingThresholdTemperature)
			.updateValue(coolingTemperature)

		const mode = this.device.getProp(this.device.props.Mode)
		if (mode == "Cool") {
			service.getCharacteristic(Characteristic.TargetTemperature)
				.updateValue(coolingTemperature)
		}
	}
	
	getHeatingThresholdTemperature() {
		let heatingTemperature = this.device.getProp(this.device.props.SetpointHeating)
		heatingTemperature = this.toHomekitTemperature(heatingTemperature)
	
		this.log(
			"Getting heating threshold temperature for %s... %s degrees C [%s]",
			this.accessory.displayName,
			heatingTemperature,
			typeof heatingTemperature
		)

		return heatingTemperature
	}
	
	setHeatingThresholdTemperature(temperature) {
		this.log(
			"Setting heating threshold temperature for %s to %s degrees C [%s]",
			this.accessory.displayName,
			temperature,
			typeof temperature
		)
	
		const mode = this.device.getProp(this.device.props.Mode)
		if (mode == "Auto") {
			// This property should only be set in Auto mode
			const heatingTemperature = this.toAlmondTemperature(temperature)
			this.device.setProp(this.device.props.SetpointHeating, heatingTemperature)
		}
	}

	updateHeatingThresholdTemperature(temperature) {
		const heatingTemperature = this.toHomekitTemperature(temperature)

		this.log(
			"Updating heating threshold temperature for %s to %s degrees C [%s]",
			this.accessory.displayName,
			heatingTemperature,
			typeof heatingTemperature
		)

		const service = this.accessory.getService(Service.Thermostat)
		service.getCharacteristic(Characteristic.HeatingThresholdTemperature)
			.updateValue(heatingTemperature)

		const mode = this.device.getProp(this.device.props.Mode)
		if (mode == "Heat") {
			service.getCharacteristic(Characteristic.TargetTemperature)
				.updateValue(heatingTemperature)
		}
	}

	getFanMode() {
		const fanMode = this.device.getProp(this.device.props.FanMode)

		this.log(
			"Getting fan mode for %s... %s [%s]",
			this.accessory.displayName,
			fanMode,
			typeof fanMode
		)

		return fanMode == "On Low"
	}
	
	setFanMode(state) {
		this.log(
			"Setting fan mode for %s to %s [%s]",
			this.accessory.displayName,
			state,
			typeof state
		)
	
		this.device.setProp(this.device.props.FanMode, state ? "On Low" : "Auto Low")
	}

	updateFanMode(mode) {
		this.log(
			"Updating fan mode for %s to %s [%s]",
			this.accessory.displayName,
			mode,
			typeof mode
		)

		this.accessory.getService(Service.Fan)
			.getCharacteristic(Characteristic.On)
			.updateValue(mode == "On Low")
	}
}

class AlmondContactSwitch extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device)

		this.log("+Service.ContactSensor")
		let service = this.acquireService(Service.ContactSensor, device.name)

		service.getCharacteristic(Characteristic.ContactSensorState)
			.on('get', (callback) => {
				callback(null, this.getContactState())
			})

		this.acquireCharacteristic(service, Characteristic.StatusTampered)
			.on('get', (callback) => {
				callback(null, this.getTamperState())
			})

		this.acquireCharacteristic(service, Characteristic.StatusLowBattery)
			.on('get', (callback) => {
				callback(null, this.getLowBatteryState())
			})

		this.addUpdateListener( (property, value) => {
			switch (property) {
				case this.device.props.State:
					this.updateContactState(value)
					break
				case this.device.props.Tamper:
					this.updateTamperState(value)
					break
				case this.device.props.LowBattery:
					this.updateLowBatteryState(value)
			}
		})

		this.log("Found 1 service.")
	}

	getContactState() {
		let state = this.device.getProp(this.device.props.State)
		state = Number(state)

		const states = [
			Characteristic.ContactSensorState.CONTACT_DETECTED,
			Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
		]

		this.log(
			"Getting contact state for %s... %s [%s]",
			this.accessory.displayName,
			states[state],
			typeof states[state]
		)

		return states[state]
	}

	updateContactState(state) {
		state = Number(state)

		const states = [
			Characteristic.ContactSensorState.CONTACT_DETECTED,
			Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
		]

		this.log(
			"Updating contact state for %s to %s [%s]",
			this.accessory.displayName,
			states[state],
			typeof states[state]
		)

		this.accessory.getService(Service.ContactSensor)
			.getCharacteristic(Characteristic.ContactSensorState)
			.updateValue(states[state])
	}

	getTamperState() {
		let state = this.device.getProp(this.device.props.Tamper)
		state = Number(state)

		const states = [
			Characteristic.StatusTampered.NOT_TAMPERED,
			Characteristic.StatusTampered.TAMPERED
		]

		this.log(
			"Getting tamper state for %s... %s [%s]",
			this.accessory.displayName,
			states[state],
			typeof states[state]
		)

		return states[state]
	}

	updateTamperState(state) {
		state = Number(state)

		const states = [
			Characteristic.StatusTampered.NOT_TAMPERED,
			Characteristic.StatusTampered.TAMPERED
		]

		this.log(
			"Updating tamper state for %s to %s [%s]",
			this.accessory.displayName,
			states[state],
			typeof states[state]
		)

		this.accessory.getService(Service.ContactSensor)
			.getCharacteristic(Characteristic.StatusTampered)
			.updateValue(states[state])
	}

	getLowBatteryState() {
		let state = this.device.getProp(this.device.props.LowBattery)
		state = Number(state)

		const states = [
			Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
			Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
		]

		this.log(
			"Getting low battery state for %s... %s [%s]",
			this.accessory.displayName,
			states[state],
			typeof states[state]
		)

		return states[state]
	}

	updateLowBatteryState(state) {
		state = Number(state)

		const states = [
			Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
			Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
		]

		this.log(
			"Updating low battery state for %s to %s [%s]",
			this.accessory.displayName,
			states[state],
			typeof states[state]
		)

		this.accessory.getService(Service.ContactSensor)
			.getCharacteristic(Characteristic.StatusLowBattery)
			.updateValue(states[state])
	}
}

class AlmondFireSensor extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device)

		this.log("+Service.SmokeSensor (FireSensor)")
		let service = this.acquireService(Service.SmokeSensor, device.name)

		service.getCharacteristic(Characteristic.SmokeDetected)
			.on('get', (callback) => {
				callback(null, this.getSmokeDetectedState())
			})

		this.acquireCharacteristic(service, Characteristic.StatusTampered)
			.on('get', (callback) => {
				callback(null, this.getTamperState())
			})

		this.acquireCharacteristic(service, Characteristic.StatusLowBattery)
			.on('get', (callback) => {
				callback(null, this.getLowBatteryState())
			})

		this.addUpdateListener( (property, value) => {
			switch (property) {
				case this.device.props.State:
					this.updateSmokeDetectedState(value)
					break
				case this.device.props.Tamper:
					this.updateTamperState(value)
					break
				case this.device.props.LowBattery:
					this.updateLowBatteryState(value)
			}
		})

		this.log("Found 1 service.")
	}

	getSmokeDetectedState() {
		let state = this.device.getProp(this.device.props.State)
		state = Number(state)

		const states = [
			Characteristic.SmokeDetected.SMOKE_NOT_DETECTED,
			Characteristic.SmokeDetected.SMOKE_DETECTED
		]
	
		this.log(
			"Getting smoke detection state for %s... %s [%s]",
			this.accessory.displayName,
			states[state],
			typeof states[state]
		)

		return states[state]
	}

	updateSmokeDetectedState(state) {
		state = Number(state)

		const states = [
			Characteristic.SmokeDetected.SMOKE_NOT_DETECTED,
			Characteristic.SmokeDetected.SMOKE_DETECTED
		]
	
		this.log(
			"Updating smoke detection state for %s to %s [%s]",
			this.accessory.displayName,
			states[state],
			typeof states[state]
		)

		this.accessory.getService(Service.SmokeSensor)
			.getCharacteristic(Characteristic.SmokeDetected)
			.updateValue(states[state])
	}

	getTamperState() {
		let state = this.device.getProp(this.device.props.Tamper)
		state = Number(state)

		const states = [
			Characteristic.StatusTampered.NOT_TAMPERED,
			Characteristic.StatusTampered.TAMPERED
		]

		this.log(
			"Getting tamper state for %s... %s [%s]",
			this.accessory.displayName,
			states[state],
			typeof states[state]
		)

		return states[state]
	}

	updateTamperState(state) {
		state = Number(state)

		const states = [
			Characteristic.StatusTampered.NOT_TAMPERED,
			Characteristic.StatusTampered.TAMPERED
		]

		this.log(
			"Updating tamper state for %s to %s [%s]",
			this.accessory.displayName,
			states[state],
			typeof states[state]
		)

		this.accessory.getService(Service.SmokeSensor)
			.getCharacteristic(Characteristic.StatusTampered)
			.updateValue(states[state])
	}

	getLowBatteryState() {
		let state = this.device.getProp(this.device.props.LowBattery)
		state = Number(state)
	
		const states = [
			Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
			Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
		]
	
		this.log(
			"Getting low battery state for %s... %s [%s]",
			this.accessory.displayName,
			states[state],
			typeof states[state]
		)

		return states[state]
	}

	updateLowBatteryState(state) {
		state = Number(state)

		const states = [
			Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
			Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
		]

		this.log(
			"Updating low battery state for %s to %s [%s]",
			this.accessory.displayName,
			states[state],
			typeof states[state]
		)

		this.accessory.getService(Service.SmokeSensor)
			.getCharacteristic(Characteristic.StatusLowBattery)
			.updateValue(states[state])
	}
}

class AlmondSmokeDetector extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device)

		// Value below which battery is considered low (arbitrary)
		this._LOW_BATTERY_THRESHOLD = 20

		this.log("+Service.SmokeSensor (SmokeDetector)")
		let service = this.acquireService(Service.SmokeSensor, device.name)

		service.getCharacteristic(Characteristic.SmokeDetected)
			.on('get', (callback) => {
				callback(null, this.getSmokeDetectedState())
			})

		this.acquireCharacteristic(service, Characteristic.StatusLowBattery)
			.on('get', (callback) => {
				callback(null, this.getLowBatteryState())
			})

		this.addUpdateListener( (property, value) => {
			switch (property) {
				case this.device.props.State:
					this.updateSmokeDetectedState(value)
					break
				case this.device.props.LowBattery:
					this.updateLowBatteryState(value)
			}
		})

		this.log("Found 1 service.")
	}
	
	getSmokeDetectedState() {
		let state = this.device.getProp(this.device.props.Status) > 0
		state = Number(state)

		const states = [
			Characteristic.SmokeDetected.SMOKE_NOT_DETECTED,
			Characteristic.SmokeDetected.SMOKE_DETECTED
		]
	
		this.log(
			"Getting smoke detection state for %s... %s [%s]",
			this.accessory.displayName,
			states[state],
			typeof states[state]
		)

		return states[state]
	}

	updateSmokeDetectedState(state) {
		state = Number(state > 0)

		const states = [
			Characteristic.SmokeDetected.SMOKE_NOT_DETECTED,
			Characteristic.SmokeDetected.SMOKE_DETECTED
		]
	
		this.log(
			"Updating smoke detection state for %s to %s [%s]",
			this.accessory.displayName,
			states[state],
			typeof states[state]
		)

		this.accessory.getService(Service.SmokeSensor)
			.getCharacteristic(Characteristic.SmokeDetected)
			.updateValue(states[state])
	}

	getLowBatteryState() {
		let state = this.device.getProp(this.device.props.Battery) <= this._LOW_BATTERY_THRESHOLD
		state = Number(state)
	
		const states = [
			Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
			Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
		]
	
		this.log(
			"Getting low battery state for %s... %s [%s]",
			this.accessory.displayName,
			states[state],
			typeof states[state]
		)

		return states[state]
	}

	updateLowBatteryState(state) {
		state = Number(state <= this._LOW_BATTERY_THRESHOLD)

		const states = [
			Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
			Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
		]

		this.log(
			"Updating low battery state for %s to %s [%s]",
			this.accessory.displayName,
			states[state],
			typeof states[state]
		)

		this.accessory.getService(Service.SmokeSensor)
			.getCharacteristic(Characteristic.StatusLowBattery)
			.updateValue(states[state])
	}
}

class AlmondGarageDoorOpener extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device)

		this.log("+Service.GarageDoorOpener")
		let service = this.acquireService(Service.GarageDoorOpener, device.name)

		service.getCharacteristic(Characteristic.CurrentDoorState)
			.on('get', (callback) => {
				callback(null, this.getCurrentDoorState())
			})

		service.getCharacteristic(Characteristic.TargetDoorState)
			.on('get', (callback) => {
				callback(null, this.getTargetDoorState())
			})
			.on('set', (value, callback) => {
				callback(null)
				this.setTargetDoorState(value)
			})

		service.getCharacteristic(Characteristic.ObstructionDetected)
			.on('get', (callback) => {
				callback(null, this.getObstructionDetected())
			})

		this.addUpdateListener( (property, value) => {
			switch (property) {
				case this.device.props.BarrierOperator:
					this.updateGarageDoorState(value)
			}
		})

		this.log("Found 1 service.")
	}

	getCurrentDoorState() {
		const states = {
			0: Characteristic.CurrentDoorState.CLOSED,
			252: Characteristic.CurrentDoorState.CLOSING,
			253: Characteristic.CurrentDoorState.STOPPED,
			254: Characteristic.CurrentDoorState.OPENING,
			255: Characteristic.CurrentDoorState.OPEN
		}

		let state = this.device.getProp(this.device.props.BarrierOperator)

		this.log(
			"Getting current door state for %s... %s [%s]",
			this.accessory.displayName,
			states[state],
			typeof states[state]
		)

		return states[state]
	}
	
	getTargetDoorState() {
		let targetState
		if (this.device._targetDoorState !== undefined) {
			targetState = this.device._targetDoorState
		} else {
			const currentState = this.device.getProp(this.device.props.BarrierOperator)
			if (currentState == 0 || currentState == 252) {
				targetState = Characteristic.TargetDoorState.CLOSED
			} else if (currentState == 254 || currentState == 255) {
				targetState = Characteristic.TargetDoorState.OPEN
			} else {
				// Not sure if this is the best default, but we have to answer
				targetState = Characteristic.TargetDoorState.CLOSED
			}
		}
	
		this.log(
			"Getting target door state for %s... %s [%s]",
			this.accessory.displayName,
			targetState,
			typeof targetState
		)

		return targetState
	}
	
	setTargetDoorState(state) {
		this.log(
			"Setting target door state for %s to %s [%s]",
			this.accessory.displayName,
			state,
			typeof state
		)
	
		const states = []
		states[Characteristic.TargetDoorState.OPEN] = 255
		states[Characteristic.TargetDoorState.CLOSED] = 0
	
		this.device.setProp(this.device.props.BarrierOperator, states[state])
	}
	
	getObstructionDetected() {
		let obstruction = this.device.getProp(this.device.props.BarrierOperator) == 253
	
		this.log(
			"Getting obstruction detection state for %s... %s [%s]",
			this.accessory.displayName,
			obstruction,
			typeof obstruction
		)

		return obstruction
	}

	updateGarageDoorState(state) {
		this.log(
			"Updating door state for %s to %s [%s]",
			this.accessory.displayName,
			state,
			typeof state
		)

	const service = this.accessory.getService(Service.GarageDoorOpener)
		switch (state) {
			case 0:
				service.getCharacteristic(Characteristic.ObstructionDetected)
					.updateValue(false)
				service.getCharacteristic(Characteristic.TargetDoorState)
					.updateValue(Characteristic.TargetDoorState.CLOSED)
				service.getCharacteristic(Characteristic.CurrentDoorState)
					.updateValue(Characteristic.CurrentDoorState.CLOSED)
				break
			case 252:
				service.getCharacteristic(Characteristic.TargetDoorState)
					.updateValue(Characteristic.TargetDoorState.CLOSED)
				service.getCharacteristic(Characteristic.CurrentDoorState)
					.updateValue(Characteristic.CurrentDoorState.CLOSING)
				break
			case 253:
				service.getCharacteristic(Characteristic.CurrentDoorState)
					.updateValue(Characteristic.CurrentDoorState.STOPPED)
				service.getCharacteristic(Characteristic.ObstructionDetected)
					.updateValue(true)
				break
			case 254:
				service.getCharacteristic(Characteristic.TargetDoorState)
					.updateValue(Characteristic.TargetDoorState.OPEN)
				service.getCharacteristic(Characteristic.CurrentDoorState)
					.updateValue(Characteristic.CurrentDoorState.OPENING)
				break
			case 255:
				service.getCharacteristic(Characteristic.ObstructionDetected)
					.updateValue(false)
				service.getCharacteristic(Characteristic.TargetDoorState)
					.updateValue(Characteristic.TargetDoorState.OPEN)
				service.getCharacteristic(Characteristic.CurrentDoorState)
					.updateValue(Characteristic.CurrentDoorState.OPEN)
		}
	}
}

class AlmondGenericPsmFan extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device)

		// Set default rotation speed for when it can't be determined
		this._DEFAULT_SPEED = 100
		this._cachedSpeed = this._DEFAULT_SPEED

		this.log("+Service.Fan")
		let service = this.acquireService(Service.Fan, device.name)

		service.getCharacteristic(Characteristic.On)
			.on('get', (callback) => {
				callback(null, this.getState())
			})
			.on('set', (value, callback) => {
				callback(null)
				this.setState(value)
			})

		this.acquireCharacteristic(service, Characteristic.RotationSpeed)
			.on('get', (callback) => {
				callback(null, this.getRotationSpeed())
			})
			.on('set', (value, callback) => {
				callback(null)
				this.setRotationSpeed(value)
			})

		this.addUpdateListener( (property, value) => {
			switch (property) {
				case this.device.props.SwitchMultilevel:
					this.updateGenericPsmFan(value)
			}
		})

		this.log("Found 1 service.")
	}

	getState() {
		let speed = this.device.getProp(this.device.props.SwitchMultilevel)
		let state = speed > 0
	
		this.log(
			"Getting state for %s... %s [%s]",
			this.accessory.displayName,
			state,
			typeof state
		)

		return state
	}
	
	setState(state) {
		this.log(
			"Setting state for %s to %s [%s]",
			this.accessory.displayName,
			state,
			typeof state
		)

		const oldSpeed = this.device.getProp(this.device.props.SwitchMultilevel)
		if (oldSpeed > 0 && oldSpeed <= 100) {
			this._cachedSpeed = oldSpeed
		}

		let newSpeed
		if (state) {
			if (this._cachedSpeed === undefined) {
				newSpeed = this._DEFAULT_SPEED
				this._cachedSpeed == newSpeed
			} else {
				newSpeed = this._cachedSpeed
			}
		} else {
			newSpeed = 0
		}

		this.device.setProp(this.device.props.SwitchMultilevel, newSpeed)
	}

	getRotationSpeed() {
		let speed = this.device.getProp(this.device.props.SwitchMultilevel)

		this.log(
			"Getting rotation speed for %s... %s% [%s]",
			this.accessory.displayName,
			speed,
			typeof speed
		)

		return speed
	}
	
	setRotationSpeed(speed) {
		this.log(
			"Setting rotation speed for %s to %s% [%s]",
			this.accessory.displayName,
			speed,
			typeof speed
		)

		if (speed > 0 && speed <= 100) {
			this._cachedSpeed = speed
		}

		this.device.setProp(this.device.props.SwitchMultilevel, speed)
	}

	updateGenericPsmFan(speed) {
		this.log(
			"Updating rotation speed for %s to %s% [%s]",
			this.accessory.displayName,
			speed,
			typeof speed
		)

		let service = this.accessory.getService(Service.Fan)
		if (speed == 0) {
			service.getCharacteristic(Characteristic.On)
				.updateValue(false)
		} else if (speed > 0 && speed <= 100) {
			this._cachedSpeed = speed
			service.getCharacteristic(Characteristic.RotationSpeed)
				.updateValue(speed)
			service.getCharacteristic(Characteristic.On)
				.updateValue(true)
		}
	}
}

class AlmondBinarySwitch extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device)

		this.log("+Service.Switch")
		let service = this.acquireService(Service.Switch, device.name)

		service.getCharacteristic(Characteristic.On)
			.on('get', (callback) => {
				callback(null, this.getState())
			})
			.on('set', (value, callback) => {
				callback(null)
				this.setState(value)
			})

		this.addUpdateListener( (property, value) => {
			switch (property) {
				case this.device.props.SwitchBinary:
					this.updateState(value)
			}
		})

		this.log("Found 1 service.")
	}

	getState() {
		let state = this.device.getProp(this.device.props.SwitchBinary)
	
		this.log(
			"Getting state for %s... %s [%s]",
			this.accessory.displayName,
			state,
			typeof state
		)

		return state
	}

	setState(state) {
		this.log(
			"Setting state for %s to %s [%s]",
			this.accessory.displayName,
			state,
			typeof state
		)
	
		this.device.setProp(this.device.props.SwitchBinary, state)
	}

	updateState(state) {
		this.log(
			"Updating state for %s to %s [%s]",
			this.accessory.displayName,
			state,
			typeof state
		)

		this.accessory.getService(Service.Switch)
			.getCharacteristic(Characteristic.On)
			.updateValue(state)
	}
}

/*
class Almondz extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device)


	}
}
*/