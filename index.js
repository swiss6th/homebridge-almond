"use strict"

const
	Almond = require('almond-client'),
	devicePersonalities = require('almond-client/devicePersonalities'),
	debug = require('debug')('homebridge-platform-almond')

let Accessory, Characteristic, Service, UUIDGen

module.exports = homebridge => {
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

		this.deviceTypes = this.getDeviceTypes(devicePersonalities)
		this.accessories = {}
	
		this.log("Starting up, config: ", config)
	
		this.api.on('didFinishLaunching', () => {
			this.client = new Almond(this.config)
			this.client.on("ready", () => {
				this.client.getDevices().forEach(this.addAccessory, this)
				this._pruneAccessories()
				this.client.on("connected", this.onConnected.bind(this))
				this.client.on("disconnected", this.onDisconnected.bind(this))
				this.client.on("deviceAdded", this.onDeviceAdded.bind(this))
				this.client.on("deviceRemoved", this.onDeviceRemoved.bind(this))
				this.client.on("deviceUpdated", this.onDeviceUpdated.bind(this))
				this.logDeviceSummary()
			})
		})
	}

	getDeviceTypes(personalities) {
		const types = {}
		for (const type in personalities) {
			types[personalities[type].FriendlyDeviceType] = Number(type)
		}
		return types
	}

	onConnected() {
		this.updateReachabilityAll(true)
	}

	onDisconnected() {
		this.updateReachabilityAll(false)
	}

	onDeviceAdded(device) {
		this.addAccessory(device)
		this.logDeviceSummary()
	}

	onDeviceRemoved(device) {
		this.removeAccessory(device)
		this.logDeviceSummary()
	}

	onDeviceUpdated(device) {
		this.updateAccessory(device)
	}

	getConfigFlag(id, flag) {
		const devices = this.config.devices
		if (devices && id in devices) {
			return devices[id][flag]
		}
		return undefined
	}

	buildAlmondAccessory(accessory, device) {
		const deviceType = this.deviceTypes
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
				if (device.manufacturer == "GE" && device.model == "Unknown: type=4944,") {
					// This is a GE continuous fan controller, which shows up as a siren in the Almond app
					almondAccessory = new AlmondGenericPsmFan(this.log, accessory, device)
				}
				break
			case deviceType.AlmondClick:
				almondAccessory = new AlmondClick(this.log, accessory, device)
				break
			case deviceType.BinarySwitch:
			case deviceType.UnknownOnOffModule:
				switch (this.getConfigFlag(device.id, "setupAs")) {
					case "outlet":
						almondAccessory = new AlmondOutlet(this.log, accessory, device)
						break
					case "switch":
					default:
						almondAccessory = new AlmondBinarySwitch(this.log, accessory, device)
				}
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
		this.log(`Got device. Name: ${device.name}, ID: ${device.id}, Type: ${device.type}`)

		if (this.getConfigFlag(device.id, "skip")) {
			this.log("Device skipped by config.")
			return
		}

		if (device.props === undefined) {
			this.log("Device not supported.")
			return
		}

		const uuid = UUIDGen.generate(`AlmondDevice: ${device.id}`)
		const existingAccessory = this.accessories[uuid]
		let accessory

		if (existingAccessory === undefined) {
			accessory = new Accessory(device.name, uuid)
		} else {
			accessory = existingAccessory
		}

		const almondAccessory = this.buildAlmondAccessory(accessory, device)

		if (almondAccessory === undefined) {
			this.log(`No services supported: ${device.name} [${device.type}]`)
			return
		}

		// Now that the device is configured, add it to HomeKit if not already present
		if (existingAccessory === undefined) {
			this.api.registerPlatformAccessories("homebridge-platform-almond", "Almond", [accessory])
		}

		this.accessories[uuid] = almondAccessory
	}

	removeAccessory(device) {
		for (const key in this.accessories) {
			let almondAccessory = this.accessories[key]
			if (almondAccessory.device === device) {
				this.log(`Removing accessory ${almondAccessory.accessory.displayName}`)
				this.api.unregisterPlatformAccessories("homebridge-platform-almond", "Almond", [almondAccessory.accessory])
				delete this.accessories[key]
				return
			}
		}
	}

	updateAccessory(device) {
		for (const key in this.accessories) {
			let almondAccessory = this.accessories[key]
			if (almondAccessory.device === device) {
				this.log(`Updating accessory information for ${almondAccessory.accessory.displayName}`)
				almondAccessory.setAccessoryInformation(device)
				return
			}
		}
	}

	configureAccessory(accessory) {
		this.log(`Configuring Accessory from cache: ${accessory.UUID} [${accessory.displayName}]`)
		this.accessories[accessory.UUID] = accessory
	}

	updateReachabilityAll(reachable) {
		this.log(`Updating reachability of all accessories to ${reachable}`)
		for (const key in this.accessories) {
			this.accessories[key].updateReachability(reachable)
		}
	}

	_pruneAccessories() {
		// After we have got all the devices from the Almond+,
		// check to see if we have any dead cached devices and kill them.
		let accessory
		for (const key in this.accessories) {
			accessory = this.accessories[key]
			this.log(`Checking existance of ${accessory.displayName}:`)
			if (accessory instanceof AlmondAccessory) {
				this.log("(+) Device exists.")
			} else {
				this.log(`(-) Did not find device for accessory ${accessory.displayName}. Removing it.`)
				this.removeAccessory(accessory.device)
			}
		}
	}

	logDeviceSummary() {
		const accessoryTotal = Object.keys(this.accessories).length
		let serviceTotal = 0
		for (const key in this.accessories) {
			const accessory = this.accessories[key]
			serviceTotal += Object.keys(accessory.services).length
		}

		this.log(`Now running with ${accessoryTotal} ${accessoryTotal == 1 ? "accessory" : "accessories"
			} and ${serviceTotal} ${serviceTotal == 1 ? "service" : "services"}.`)
	}
}

// Foundation class for all Almond+ accessories

class AlmondAccessory {
	constructor(log, accessory, device) {
		this.accessory = accessory
		this.device = device
		this.log = log
		this.displayName = this.accessory.displayName
		this.services = {}

		// This is arbitrary and may be overridden in subclasses.
		// It is used by BatteryService and others.
		this._LOW_BATTERY_THRESHOLD = 20 // %

		this.log(`Setting up ${this.accessory.displayName}...`)

		this.AccessoryInformation = this.setAccessoryInformation(device)
		this.accessory.on('identify', this.identifyDevice.bind(this))
		this.observeDevice(device)
		this.updateReachability(true)
	}

	setAccessoryInformation(device) {
		return this.accessory.getService(Service.AccessoryInformation)
			.setCharacteristic(Characteristic.Manufacturer, device.manufacturer)
			.setCharacteristic(Characteristic.Model, device.model)
			.setCharacteristic(Characteristic.SerialNumber, `${device.name} [${device.id}]`)
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

	updateReachability(reachable) {
		this.accessory.updateReachability(reachable)
	}

	observeDevice(device) {
	}

	// To be overridden in subclasses
	identifyDevice(paired, callback) {
		this.log(`${this.accessory.displayName} identified`)
		callback()
	}

	logServiceCount() {
		const serviceCount = Object.keys(this.services).length
		this.log(`Found ${serviceCount} ${serviceCount == 1 ? "service" : "services"}.`)
	}

	logGet(propertyString, value, unitsString = '') {
		this.log(`Getting ${propertyString} for ${this.accessory.displayName}... ${value}${unitsString} [${typeof value}]`)
	}

	logSet(propertyString, value, unitsString = '') {
		this.log(`Setting ${propertyString} for ${this.accessory.displayName} to ${value}${unitsString} [${typeof value}]`)
	}

	logUpdate(propertyString, value, unitsString = '') {
		this.log(`Updating ${propertyString} for ${this.accessory.displayName} to ${value}${unitsString} [${typeof value}]`)
	}

	setupService(serviceString) {
		if (typeof serviceString !== 'string' || serviceString === '') return

		this.log(`+Service.${serviceString}`)

		this.services[serviceString] = this.acquireService(Service[serviceString], this.device.name)
		this[serviceString] = {}
	}

	setupCharacteristic (
		serviceString,
		characteristicString,
		propertyString,
		updateFunction = this[`update${characteristicString}`],
		getFunction = this[`get${characteristicString}`],
		setFunction = this[`set${characteristicString}`]
	) {
		const service = this.services[serviceString]
		const characteristic = this.acquireCharacteristic(service, Characteristic[characteristicString])
		this[serviceString][characteristicString] = characteristic

		if (getFunction) {
			getFunction = getFunction.bind(this)
			characteristic.on('get', (callback) => {
				callback(null, getFunction())
			})
		}

		if (setFunction) {
			setFunction = setFunction.bind(this)
			characteristic.on('set', (value, callback) => {
				setFunction(value)
				callback(null)
			})
		}

		const property = this.device.props[propertyString]
		if (typeof property === 'number' && updateFunction) {
			this.device.on(property, updateFunction.bind(this))
		}
	}

	setupCharacteristics(serviceString, characteristicDefinitions) {
		if (this.services[serviceString] === undefined) this.setupService(serviceString)

		for (const definition of characteristicDefinitions) {
			this.setupCharacteristic(serviceString, ...definition)
		}
	}

	addBatteryService(device, propBatteryLevel = "Battery", propStatusLowBattery = "Battery") {
		this.setupCharacteristics("BatteryService", [
			["BatteryLevel", propBatteryLevel],
			["ChargingState"],
			["StatusLowBattery", propStatusLowBattery]
		])
	}

	// Battery methods may be overridden in subclasses.
	// Otherwise, they read the standard Battery property of Almond+ devices.
	// Devices with only a LowBattery property should not need a BatteryService.
	// Instead, add the StatusLowBattery characteristic and deal with it individually.

	getBatteryLevel(prop = this.device.props.Battery) {
		let level = this.device.getProp(prop)
		level = level >= 0 && level <= 100 ? level : 0

		this.logGet("battery level", level, "%")

		return level
	}

	updateBatteryLevel(level) {
		if (level >= 0 && level <= 100) {
			this.logUpdate("battery level", level, "%")

			this.BatteryService.BatteryLevel.updateValue(level)
		}
	}

	getStatusLowBattery(prop = this.device.props.Battery) {
		const status = this.device.getProp(prop) <= this._LOW_BATTERY_THRESHOLD
			? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
			: Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL

		this.logGet("low battery state", status)

		return status
	}

	updateStatusLowBattery(level) {
		const status = level <= this._LOW_BATTERY_THRESHOLD
			? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
			: Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL

		this.logGet("low battery state", status)

		return status
	}

	getChargingState() {
		// Since no Almond+ devices report charging state, return constant
		const state = Characteristic.ChargingState.NOT_CHARGEABLE

		this.logGet("charging state", state)

		return state
	}
}

// Almond+ accessory classes

class AlmondMultilevelSwitch extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device)

		// Set default brightness for when it can't be determined
		this._DEFAULT_BRIGHTNESS = 100
		this._cachedBrightness = this._DEFAULT_BRIGHTNESS

		this.setupCharacteristics("Lightbulb", [
			["On", "SwitchMultilevel"],
			["Brightness", "SwitchMultilevel"]
		])

		this.logServiceCount()
	}

	getOn() {
		let value = this.device.getProp(this.device.props.SwitchMultilevel)
		let state = value > 0
	
		this.logGet("state", state)

		return state
	}
	
	setOn(state) {
		this.logSet("state", state)
	
		const oldBrightness = this.device.getProp(this.device.props.SwitchMultilevel)
		if (oldBrightness > 0 && oldBrightness <= 100) {
			this._cachedBrightness = oldBrightness
		}

		let newBrightness
		if (state) {
			if (this._cachedBrightness === undefined) {
				newBrightness = this._DEFAULT_BRIGHTNESS
				this._cachedBrightness = newBrightness
			} else {
				newBrightness = this._cachedBrightness
			}
		} else {
			newBrightness = 0
		}

		this.device.setProp(this.device.props.SwitchMultilevel, newBrightness)
	}

	updateOn(brightness) {
		if (brightness >= 0 && brightness <= 100) {
			const state = brightness > 0

			this.logUpdate("state", state)

			this.Lightbulb.On.updateValue(state)
		}
	}

	getBrightness() {
		let brightness = this.device.getProp(this.device.props.SwitchMultilevel)

		this.logGet("brightness", brightness, "%")

		return brightness
	}
	
	setBrightness(brightness) {
		this.logSet("brightness", brightness, "%")

		if (brightness > 0 && brightness <= 100) {
			this._cachedBrightness = brightness
		}

		this.device.setProp(this.device.props.SwitchMultilevel, brightness)
	}

	updateBrightness(brightness) {
		if (brightness > 0 && brightness <= 100) {
			this.logUpdate("brightness", brightness, "%")

			this._cachedBrightness = brightness

			this.Lightbulb.Brightness.updateValue(brightness)
		}
	}
}

class AlmondMultilevelSwitchOnOff extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device)

		this.setupCharacteristics("Lightbulb", [
			["On", "SwitchBinary"],
			["Brightness", "SwitchMultilevel"]
		])

		this.logServiceCount()
	}

	getOn() {
		let state = this.device.getProp(this.device.props.SwitchBinary)
	
		this.logGet("state", state)

		return state
	}
	
	setOn(state) {
		this.logSet("state", state)

		this.device.setProp(this.device.props.SwitchBinary, state)
	}

	getBrightness() {
		let brightness = this.device.getProp(this.device.props.SwitchMultilevel)
		brightness = Math.round(brightness / 255 * 100)
	
		this.logGet("brightness", brightness, "%")

		return brightness
	}

	setBrightness(brightness) {
		this.logSet("brightness", brightness, "%")

		this.device.setProp(this.device.props.SwitchMultilevel, Math.round(brightness / 100 * 255))
	}

	updateOn(state) {
		this.logUpdate("state", state)

		this.Lightbulb.On.updateValue(state)
	}

	updateBrightness(brightness) {
		const newBrightness = Math.round(brightness / 255 * 100)

		this.logUpdate("brightness", newBrightness, "%")

		this.Lightbulb.Brightness.updateValue(newBrightness)
	}
}

class AlmondThermostat extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device)

		this.setupCharacteristics("Thermostat", [
			["CurrentHeatingCoolingState", "OperatingState"],
			["TargetHeatingCoolingState", "Mode"],
			["CurrentTemperature", "Temperature"],
			["TargetTemperature"], // This is updated in HeatingThresholdTemperature & CoolingThresholdTemperature
			["TemperatureDisplayUnits", "Units"],
			["CurrentRelativeHumidity", "Humidity"],
			["HeatingThresholdTemperature", "SetpointHeating"],
			["CoolingThresholdTemperature", "SetpointCooling"]
		])

		this.setupCharacteristics("Fan", [
			["On", "FanMode"]
		])

		this.addBatteryService(this.device)

		this.logServiceCount()
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
	
		this.logGet("current operating state", state)

		return states[state]
	}

	updateCurrentHeatingCoolingState(state) {
		const states = {
			"Idle": Characteristic.CurrentHeatingCoolingState.OFF,
			"Heating": Characteristic.CurrentHeatingCoolingState.HEAT,
			"Cooling": Characteristic.CurrentHeatingCoolingState.COOL
		}
	
		this.logUpdate("current operating state", state)

		this.Thermostat.CurrentHeatingCoolingState.updateValue(states[state])
	}

	getTargetHeatingCoolingState() {
		const state = this.device.getProp(this.device.props.Mode)
	
		const states = {
			"Off": Characteristic.TargetHeatingCoolingState.OFF,
			"Heat": Characteristic.TargetHeatingCoolingState.HEAT,
			"Cool": Characteristic.TargetHeatingCoolingState.COOL,
			"Auto": Characteristic.TargetHeatingCoolingState.AUTO
		}
	
		this.logGet("target operating mode", state)

		return states[state]
	}

	setTargetHeatingCoolingState(state) {
		this.logSet("target operating mode", state)

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

		this.Thermostat.TargetTemperature.updateValue(targetTemperature)
	}

	updateTargetHeatingCoolingState(state) {
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

		this.logUpdate("target operating mode", state)
		this.Thermostat.TargetHeatingCoolingState.updateValue(states[state])
		this.logUpdate("target temperature", targetTemperature, "° C")
		this.Thermostat.TargetTemperature.updateValue(targetTemperature)
	}

	getCurrentTemperature() {
		let temperature = this.device.getProp(this.device.props.Temperature)
		temperature = this.toHomekitTemperature(temperature)
	
		this.logGet("current temperature", temperature, "° C")

		return temperature
	}
	
	updateCurrentTemperature(temperature) {
		temperature = this.toHomekitTemperature(temperature)

		this.logUpdate("current temperature", temperature, "° C")

		this.Thermostat.CurrentTemperature.updateValue(temperature)
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
	
		this.logGet("target temperature", targetTemperature, "° C")

		return targetTemperature
	}
	
	setTargetTemperature(temperature) {
		this.logSet("target temperature", temperature, "° C")

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
	
		this.logGet("temperature display units", `degrees ${units}`)

		return unitTypes[units]
	}

	setTemperatureDisplayUnits(units) {
		const unitTypes = []
		unitTypes[Characteristic.TemperatureDisplayUnits.CELSIUS] = "C"
		unitTypes[Characteristic.TemperatureDisplayUnits.FAHRENHEIT] = "F"

		this.logSet("temperature display units", unitTypes[units])
	
		// Almond+ doesn't allow this to be set
		//this.device.setProp(this.device.props.Units, unitTypes[units])
	}

	updateTemperatureDisplayUnits(units) {
		const unitTypes = {
			"C": Characteristic.TemperatureDisplayUnits.CELSIUS,
			"F": Characteristic.TemperatureDisplayUnits.FAHRENHEIT
		}
	
		this.logUpdate("temperature display units", `degrees ${unitTypes[units]}`)

		this.Thermostat.TemperatureDisplayUnits.updateValue(unitTypes[units])
	}

	getCurrentRelativeHumidity() {
		let humidity = this.device.getProp(this.device.props.Humidity)
		humidity = Math.round(humidity)

		this.logGet("current relative humidity", humidity, "%")

		return humidity
	}

	updateCurrentRelativeHumidity(humidity) {
		humidity = Math.round(humidity)

		this.logUpdate("current relative humidity", humidity, "%")

		this.Thermostat.CurrentRelativeHumidity.updateValue(humidity)
	}
	
	getHeatingThresholdTemperature() {
		let heatingTemperature = this.device.getProp(this.device.props.SetpointHeating)
		heatingTemperature = this.toHomekitTemperature(heatingTemperature)
	
		this.logGet("heating threshold temperature", heatingTemperature, "° C")

		return heatingTemperature
	}
	
	setHeatingThresholdTemperature(temperature) {
		this.logSet("heating threshold temperature", temperature, "° C")
	
		const mode = this.device.getProp(this.device.props.Mode)
		if (mode == "Auto") {
			// This property should only be set in Auto mode
			const heatingTemperature = this.toAlmondTemperature(temperature)
			this.device.setProp(this.device.props.SetpointHeating, heatingTemperature)
		}
	}

	updateHeatingThresholdTemperature(temperature) {
		const heatingTemperature = this.toHomekitTemperature(temperature)

		this.logUpdate("heating threshold temperature", heatingTemperature, "° C")
		this.Thermostat.HeatingThresholdTemperature.updateValue(heatingTemperature)

		const mode = this.device.getProp(this.device.props.Mode)
		if (mode == "Heat") {
			this.logUpdate("target temperature", heatingTemperature, "° C")
			this.Thermostat.TargetTemperature.updateValue(heatingTemperature)
		}
	}

	getCoolingThresholdTemperature() {
		let coolingTemperature = this.device.getProp(this.device.props.SetpointCooling)
		coolingTemperature = this.toHomekitTemperature(coolingTemperature)
	
		this.logGet("cooling threshold temperature", coolingTemperature, "° C")

		return coolingTemperature
	}
	
	setCoolingThresholdTemperature(temperature) {
		this.logSet("cooling threshold temperature", temperature, "° C")
	
		const mode = this.device.getProp(this.device.props.Mode)
		if (mode == "Auto") {
			// This property should only be set in Auto mode
			const coolingTemperature = this.toAlmondTemperature(temperature)
			this.device.setProp(this.device.props.SetpointCooling, coolingTemperature)
		}
	}
	
	updateCoolingThresholdTemperature(temperature) {
		const coolingTemperature = this.toHomekitTemperature(temperature)

		this.logUpdate("cooling threshold temperature", coolingTemperature, "° C")
		this.Thermostat.CoolingThresholdTemperature.updateValue(coolingTemperature)

		const mode = this.device.getProp(this.device.props.Mode)
		if (mode == "Cool") {
			this.logUpdate("target temperature", coolingTemperature, "° C")
			this.Thermostat.TargetTemperature.updateValue(coolingTemperature)
		}
	}

	getOn() {
		const fanMode = this.device.getProp(this.device.props.FanMode)

		this.logGet("fan mode", fanMode)

		return fanMode == "On Low"
	}

	setOn(state) {
		this.logSet("fan mode", state)
	
		this.device.setProp(this.device.props.FanMode, state ? "On Low" : "Auto Low")
	}

	updateOn(mode) {
		this.logUpdate("fan mode", mode)

		this.Fan.On.updateValue(mode == "On Low")
	}
}

class AlmondContactSwitch extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device)

		this.setupCharacteristics("ContactSensor", [
			["ContactSensorState", "State"],
			["StatusTampered", "Tamper"],
			["StatusLowBattery", "LowBattery"]
		])

		this.logServiceCount()
	}

	getContactSensorState() {
		let state = this.device.getProp(this.device.props.State)
		state = Number(state)

		const states = [
			Characteristic.ContactSensorState.CONTACT_DETECTED,
			Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
		]

		this.logGet("contact state", states[state])

		return states[state]
	}

	updateContactSensorState(state) {
		state = Number(state)

		const states = [
			Characteristic.ContactSensorState.CONTACT_DETECTED,
			Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
		]

		this.logUpdate("contact state", states[state])

		this.ContactSensor.ContactSensorState.updateValue(states[state])
	}

	getStatusTampered() {
		let state = this.device.getProp(this.device.props.Tamper)
		state = Number(state)

		const states = [
			Characteristic.StatusTampered.NOT_TAMPERED,
			Characteristic.StatusTampered.TAMPERED
		]

		this.logGet("tamper state", states[state])

		return states[state]
	}

	updateStatusTampered(state) {
		state = Number(state)

		const states = [
			Characteristic.StatusTampered.NOT_TAMPERED,
			Characteristic.StatusTampered.TAMPERED
		]

		this.logUpdate("tamper state", states[state])

		this.ContactSensor.StatusTampered.updateValue(states[state])
	}

	getStatusLowBattery() {
		let state = this.device.getProp(this.device.props.LowBattery)
		state = Number(state)

		const states = [
			Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
			Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
		]

		this.logGet("low battery state", states[state])

		return states[state]
	}

	updateStatusLowBattery(state) {
		state = Number(state)

		const states = [
			Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
			Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
		]

		this.logUpdate("low battery state", states[state])

		this.ContactSensor.StatusLowBattery.updateValue(states[state])
	}
}

class AlmondFireSensor extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device)

		this.setupCharacteristics("SmokeSensor", [
			["SmokeDetected", "State"],
			["StatusTampered", "Tamper"],
			["StatusLowBattery", "LowBattery"]
		])

		this.logServiceCount()
	}

	getSmokeDetected() {
		let state = this.device.getProp(this.device.props.State)
		state = Number(state)

		const states = [
			Characteristic.SmokeDetected.SMOKE_NOT_DETECTED,
			Characteristic.SmokeDetected.SMOKE_DETECTED
		]
	
		this.logGet("smoke detection state", states[state])

		return states[state]
	}

	updateSmokeDetected(state) {
		state = Number(state)

		const states = [
			Characteristic.SmokeDetected.SMOKE_NOT_DETECTED,
			Characteristic.SmokeDetected.SMOKE_DETECTED
		]
	
		this.logUpdate("smoke detection state", states[state])

		this.SmokeSensor.SmokeDetected.updateValue(states[state])
	}

	getStatusTampered() {
		let state = this.device.getProp(this.device.props.Tamper)
		state = Number(state)

		const states = [
			Characteristic.StatusTampered.NOT_TAMPERED,
			Characteristic.StatusTampered.TAMPERED
		]

		this.logGet("tamper state", states[state])

		return states[state]
	}

	updateStatusTampered(state) {
		state = Number(state)

		const states = [
			Characteristic.StatusTampered.NOT_TAMPERED,
			Characteristic.StatusTampered.TAMPERED
		]

		this.logUpdate("tamper state", states[state])

		this.SmokeSensor.StatusTampered.updateValue(states[state])
	}

	getStatusLowBattery() {
		let state = this.device.getProp(this.device.props.LowBattery)
		state = Number(state)
	
		const states = [
			Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
			Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
		]
	
		this.logGet("low battery state", states[state])

		return states[state]
	}

	updateStatusLowBattery(state) {
		state = Number(state)

		const states = [
			Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
			Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
		]

		this.logUpdate("low battery state", states[state])

		this.SmokeSensor.StatusLowBattery.updateValue(states[state])
	}
}

class AlmondSmokeDetector extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device)

		this.setupCharacteristics("SmokeSensor", [
			["SmokeDetected", "Status"],
		])

		this.addBatteryService(this.device)

		this.logServiceCount()
	}
	
	getSmokeDetected() {
		let state = this.device.getProp(this.device.props.Status) > 0
		state = Number(state)

		const states = [
			Characteristic.SmokeDetected.SMOKE_NOT_DETECTED,
			Characteristic.SmokeDetected.SMOKE_DETECTED
		]
	
		this.logGet("smoke detection state", states[state])

		return states[state]
	}

	updateSmokeDetected(state) {
		state = Number(state > 0)

		const states = [
			Characteristic.SmokeDetected.SMOKE_NOT_DETECTED,
			Characteristic.SmokeDetected.SMOKE_DETECTED
		]
	
		this.logUpdate("smoke detection state", states[state])

		this.SmokeSensor.SmokeDetected.updateValue(states[state])
	}
}

class AlmondGarageDoorOpener extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device)

		// Try changing the order and test; HomeKit may behave differently.
		// If I get different results, I may have to revert to updateGarageDoorState().
		this.setupCharacteristics("GarageDoorOpener", [
			["ObstructionDetected", "BarrierOperator"],
			["TargetDoorState", "BarrierOperator"],
			["CurrentDoorState", "BarrierOperator"]
		])

		this.logServiceCount()
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

		this.logGet("current door state", states[state])

		return states[state]
	}

	updateCurrentDoorState(state) {
		const states = {
			0: Characteristic.CurrentDoorState.CLOSED,
			252: Characteristic.CurrentDoorState.CLOSING,
			253: Characteristic.CurrentDoorState.STOPPED,
			254: Characteristic.CurrentDoorState.OPENING,
			255: Characteristic.CurrentDoorState.OPEN
		}

		this.logUpdate("current door state", state)

		this.GarageDoorOpener.CurrentDoorState.updateValue(states[state])
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
	
		this.logGet("target door state", targetState)

		return targetState
	}
	
	setTargetDoorState(state) {
		this.logSet("target door state", state)
	
		const states = []
		states[Characteristic.TargetDoorState.OPEN] = 255
		states[Characteristic.TargetDoorState.CLOSED] = 0
	
		this.device.setProp(this.device.props.BarrierOperator, states[state])
	}

	updateTargetDoorState(state) {
		this.logUpdate("target door state", state)

		switch (state) {
			case 0:
			case 252:
				this.GarageDoorOpener.TargetDoorState.updateValue(Characteristic.TargetDoorState.CLOSED)
				break
			case 254:
			case 255:
				this.GarageDoorOpener.TargetDoorState.updateValue(Characteristic.TargetDoorState.OPEN)
		}
	}

	getObstructionDetected() {
		let obstruction = this.device.getProp(this.device.props.BarrierOperator) == 253
	
		this.logGet("obstruction state", obstruction)

		return obstruction
	}

	updateObstructionDetected(state) {
		this.logUpdate("obstruction state", state)

		switch (state) {
			case 0:
			case 255:
				this.GarageDoorOpener.ObstructionDetected.updateValue(false)
				break
			case 253:
				this.GarageDoorOpener.ObstructionDetected.updateValue(true)
		}
	}
}

class AlmondGenericPsmFan extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device)

		// Set default rotation speed for when it can't be determined
		this._DEFAULT_SPEED = 100
		this._cachedSpeed = this._DEFAULT_SPEED

		this.setupCharacteristics("Fan", [
			["On", "SwitchMultilevel"],
			["RotationSpeed", "SwitchMultilevel"]
		])

		this.logServiceCount()
	}

	getOn() {
		let speed = this.device.getProp(this.device.props.SwitchMultilevel)
		let state = speed > 0
	
		this.logGet("state", state)

		return state
	}
	
	setOn(state) {
		this.logSet("state", state)

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

	updateOn(speed) {
		if (speed >= 0 && speed <= 100) {
			const state = speed > 0

			this.logUpdate("state", state)

			this.Fan.On.updateValue(state)
		}
	}

	getRotationSpeed() {
		let speed = this.device.getProp(this.device.props.SwitchMultilevel)

		this.logGet("rotation speed", speed, "%")

		return speed
	}
	
	setRotationSpeed(speed) {
		this.logSet("rotation speed", speed, "%")

		if (speed > 0 && speed <= 100) {
			this._cachedSpeed = speed
		}

		this.device.setProp(this.device.props.SwitchMultilevel, speed)
	}

	updateRotationSpeed(speed) {
		if (speed > 0 && speed <= 100) {
			this.logUpdate("rotation speed", speed, "%")
	
			this._cachedSpeed = speed
			this.Fan.RotationSpeed.updateValue(speed)
		}
	}
}

class AlmondBinarySwitch extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device)

		this.setupCharacteristics("Switch", [
			["On", "SwitchBinary"]
		])

		this.logServiceCount()
	}

	getOn() {
		let state = this.device.getProp(this.device.props.SwitchBinary)
	
		this.logGet("state", state)

		return state
	}

	setOn(state) {
		this.logSet("state", state)

		this.device.setProp(this.device.props.SwitchBinary, state)
	}

	updateOn(state) {
		this.logUpdate("state", state)

		this.Switch.On.updateValue(state)
	}
}

class AlmondOutlet extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device)

		this.setupCharacteristics("Outlet", [
			["On", "SwitchBinary"],
			["OutletInUse"]
		])

		this.logServiceCount()
	}

	getOn() {
		let state = this.device.getProp(this.device.props.SwitchBinary)
	
		this.logGet("state", state)

		return state
	}

	setOn(state) {
		this.logSet("state", state)
	
		this.device.setProp(this.device.props.SwitchBinary, state)
	}

	updateOn(state) {
		this.logUpdate("state", state)
		this.Outlet.On.updateValue(state)

		this.logUpdate("usage state", state)
		this.Outlet.OutletInUse.updateValue(state)
	}

	getOutletInUse() {
		let state = this.device.getProp(this.device.props.SwitchBinary)

		this.logGet("usage state", state)

		return state
	}
}

class AlmondClick extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device)

		this.setupCharacteristics("StatelessProgrammableSwitch", [
			["ProgrammableSwitchEvent", "Press"]
		])

		this.logServiceCount()
	}

	getProgrammableSwitchEvent() {
		const press = this.device.getProp(this.device.props.Press)

		this.logGet("press", press)

		const events = {
			3: Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
			0: Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS,
			2: Characteristic.ProgrammableSwitchEvent.LONG_PRESS
		}

		return events[press]
	}

	updateProgrammableSwitchEvent(press) {
		this.logUpdate("press", press)

		const events = {
			3: Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
			0: Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS,
			2: Characteristic.ProgrammableSwitchEvent.LONG_PRESS
		}

		this.StatelessProgrammableSwitch.ProgrammableSwitchEvent.updateValue(events[press])
	}
}

/*
class Almondx extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device)


	}
}
*/