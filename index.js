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

	acquireService(service, subtype, name) {
		let existingService

		if (subtype) {
			existingService = this.accessory.getService(subtype)
		}

		if (existingService === undefined) {
			existingService = this.accessory.getService(service)
		}

		if (existingService === undefined) {
			return this.accessory.addService(service, name, subtype)
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

	calculateServiceIdString(serviceString = '', subtype = '') {
		return serviceString + (subtype.length > 0 ? '_' + subtype : '')
	}

	extractServiceString(serviceIdString = '') {
		return serviceIdString.split('_')[0]
	}

	extractSubtypeString(serviceIdString) {
		return serviceIdString.split('_')[1]
	}

	setupService(serviceString, subtypeString) {
		if (typeof serviceString !== 'string' || serviceString === '') return

		const service = this.acquireService(Service[serviceString], subtypeString, this.device.name)
		const serviceIdString = this.calculateServiceIdString(serviceString, service.subtype)

		this.services[serviceIdString] = service
		this[serviceIdString] = {}

		this.log(`+Service.${serviceIdString}`)
	}

	setupCharacteristic (
		serviceIdString,
		characteristicString,
		propertyString,
		updateFunction = this[`update${characteristicString}`],
		getFunction = this[`get${characteristicString}`],
		setFunction = this[`set${characteristicString}`]
	) {
		const service = this.services[serviceIdString]
		const characteristic = this.acquireCharacteristic(service, Characteristic[characteristicString])
		this[serviceIdString][characteristicString] = characteristic

		const property = this.device.props[propertyString]

		if (typeof getFunction === 'function') {
			getFunction = getFunction.bind(this, property)
			characteristic.on('get', (callback) => {
				callback(null, getFunction())
			})
		}

		if (typeof setFunction === 'function') {
			setFunction = setFunction.bind(this, property)
			characteristic.on('set', (value, callback) => {
				setFunction(value)
				callback(null)
			})
		}

		if (typeof property === 'number' && typeof updateFunction === 'function') {
			this.device.on(property, updateFunction.bind(this, characteristic))
		}
	}

	setupCharacteristics(serviceIdString, characteristicDefinitions) {
		// serviceIdString format: "ServiceName_Subtype" (e.g., "Lightbulb_Backlight")
		const serviceString = this.extractServiceString(serviceIdString)
		const subtypeString = this.extractSubtypeString(serviceIdString)

		if (this.services[serviceIdString] === undefined) this.setupService(serviceString, subtypeString)

		for (const definition of characteristicDefinitions) {
			this.setupCharacteristic(serviceIdString, ...definition)
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

	getBatteryLevel(property = this.device.props.Battery) {
		let level = this.device.getProp(property)
		level = level >= 0 && level <= 100 ? level : 0

		this.logGet("battery level", level, "%")

		return level
	}

	updateBatteryLevel(characteristic, level) {
		if (level >= 0 && level <= 100) {
			this.logUpdate("battery level", level, "%")

			characteristic.updateValue(level)
		}
	}

	getStatusLowBattery(property = this.device.props.Battery) {
		const status = this.device.getProp(property) <= this._LOW_BATTERY_THRESHOLD
			? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
			: Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL

		this.logGet("low battery state", status)

		return status
	}

	updateStatusLowBattery(characteristic, level) {
		const status = level <= this._LOW_BATTERY_THRESHOLD
			? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
			: Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL

		this.logGet("low battery state", status)

		characteristic.updateValue(status)
	}

	getChargingState(property) {
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

	getOn(property) {
		const state = this.device.getProp(property) > 0

		this.logGet("state", state)

		return state
	}

	setOn(property, state) {
		this.logSet("state", state)

		const oldBrightness = this.device.getProp(property)
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

		this.device.setProp(property, newBrightness)
	}

	updateOn(characteristic, brightness) {
		if (brightness >= 0 && brightness <= 100) {
			const state = brightness > 0

			this.logUpdate("state", state)

			characteristic.updateValue(state)
		}
	}

	getBrightness(property) {
		const brightness = this.device.getProp(property)

		this.logGet("brightness", brightness, "%")

		return brightness
	}
	
	setBrightness(property, brightness) {
		this.logSet("brightness", brightness, "%")

		if (brightness > 0 && brightness <= 100) {
			this._cachedBrightness = brightness
		}

		this.device.setProp(property, brightness)
	}

	updateBrightness(characteristic, brightness) {
		if (brightness > 0 && brightness <= 100) {
			this.logUpdate("brightness", brightness, "%")

			this._cachedBrightness = brightness

			characteristic.updateValue(brightness)
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

	getOn(property) {
		const state = this.device.getProp(property)

		this.logGet("state", state)

		return state
	}
	
	setOn(property, state) {
		this.logSet("state", state)

		this.device.setProp(property, state)
	}

	updateOn(characteristic, state) {
		this.logUpdate("state", state)

		characteristic.updateValue(state)
	}

	getBrightness(property) {
		let brightness = this.device.getProp(property)
		brightness = Math.round(brightness / 255 * 100)
	
		this.logGet("brightness", brightness, "%")

		return brightness
	}

	setBrightness(property, brightness) {
		this.logSet("brightness", brightness, "%")

		this.device.setProp(property, Math.round(brightness / 100 * 255))
	}

	updateBrightness(characteristic, brightness) {
		const newBrightness = Math.round(brightness / 255 * 100)

		this.logUpdate("brightness", newBrightness, "%")

		characteristic.updateValue(newBrightness)
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

	fetchUnits(property = this.device.props.Units) {
		return this.device.getProp(property)
	}

	toHomekitTemperature(temperature) { // Typically for values heading to HomeKit
		const units = this.fetchUnits()

		if (units == "F") {
			temperature = (temperature - 32) / 1.8
		}
		temperature = Number(temperature.toFixed(1))

		return temperature
	}

	toAlmondTemperature(temperature) { // Typically for values heading to Almond+
		const units = this.fetchUnits()

		if (units == "F") {
			temperature = Math.round(temperature * 1.8 + 32)
		}

		return temperature
	}

	calculateTargetTemperature(mode = this.device.getProp(this.device.props.Mode)) {
		let targetTemperature = 0

		switch (mode) {
			case "Heat":
				targetTemperature = this.device.getProp(this.device.props.SetpointHeating)
				break
			case "Cool":
				targetTemperature = this.device.getProp(this.device.props.SetpointCooling)
				break
			case "Auto":
			case "Off":
				// This is bogus, but we have to give an answer
				const heatingTemperature = this.device.getProp(this.device.props.SetpointHeating)
				const coolingTemperature = this.device.getProp(this.device.props.SetpointCooling)
				targetTemperature = Number(((heatingTemperature + coolingTemperature) / 2).toFixed(1))
		}

		return this.toHomekitTemperature(targetTemperature)
	}

	getCurrentHeatingCoolingState(property) {
		const state = this.device.getProp(property)

		const states = {
			"Idle": Characteristic.CurrentHeatingCoolingState.OFF,
			"Heating": Characteristic.CurrentHeatingCoolingState.HEAT,
			"Cooling": Characteristic.CurrentHeatingCoolingState.COOL
		}
	
		this.logGet("current operating state", state)

		return states[state]
	}

	updateCurrentHeatingCoolingState(characteristic, state) {
		const states = {
			"Idle": Characteristic.CurrentHeatingCoolingState.OFF,
			"Heating": Characteristic.CurrentHeatingCoolingState.HEAT,
			"Cooling": Characteristic.CurrentHeatingCoolingState.COOL
		}
	
		this.logUpdate("current operating state", state)

		characteristic.updateValue(states[state])
	}

	getTargetHeatingCoolingState(property) {
		const state = this.device.getProp(property)
	
		const states = {
			"Off": Characteristic.TargetHeatingCoolingState.OFF,
			"Heat": Characteristic.TargetHeatingCoolingState.HEAT,
			"Cool": Characteristic.TargetHeatingCoolingState.COOL,
			"Auto": Characteristic.TargetHeatingCoolingState.AUTO
		}
	
		this.logGet("target operating mode", state)

		return states[state]
	}

	setTargetHeatingCoolingState(property, state) {
		const states = []
		states[Characteristic.TargetHeatingCoolingState.OFF] = "Off"
		states[Characteristic.TargetHeatingCoolingState.HEAT] = "Heat"
		states[Characteristic.TargetHeatingCoolingState.COOL] = "Cool"
		states[Characteristic.TargetHeatingCoolingState.AUTO] = "Auto"

		this.logSet("target operating mode", states[state])
		this.device.setProp(property, states[state])

		const targetTemperature = this.calculateTargetTemperature(states[state])

		this.logUpdate("target temperature", targetTemperature, "° C")
		this.Thermostat.TargetTemperature.updateValue(targetTemperature)
	}

	updateTargetHeatingCoolingState(characteristic, state) {
		const states = {
			"Off": Characteristic.TargetHeatingCoolingState.OFF,
			"Heat": Characteristic.TargetHeatingCoolingState.HEAT,
			"Cool": Characteristic.TargetHeatingCoolingState.COOL,
			"Auto": Characteristic.TargetHeatingCoolingState.AUTO
		}

		this.logUpdate("target operating mode", state)
		characteristic.updateValue(states[state])

		const targetTemperature = this.calculateTargetTemperature(state)

		this.logUpdate("target temperature", targetTemperature, "° C")
		this.Thermostat.TargetTemperature.updateValue(targetTemperature)
	}

	getCurrentTemperature(property) {
		let temperature = this.device.getProp(property)
		temperature = this.toHomekitTemperature(temperature)

		this.logGet("current temperature", temperature, "° C")

		return temperature
	}
	
	updateCurrentTemperature(characteristic, temperature) {
		temperature = this.toHomekitTemperature(temperature)

		this.logUpdate("current temperature", temperature, "° C")

		characteristic.updateValue(temperature)
	}
	
	getTargetTemperature(property) {
		const targetTemperature = this.calculateTargetTemperature()

		this.logGet("target temperature", targetTemperature, "° C")

		return targetTemperature
	}
	
	setTargetTemperature(property, temperature) {
		this.logSet("target temperature", temperature, "° C")

		let targetTemperature = this.toAlmondTemperature(temperature)
		const mode = this.device.getProp(this.device.props.Mode)
		if (mode == "Heat") {
			this.device.setProp(this.device.props.SetpointHeating, targetTemperature)
		} else if (mode == "Cool") {
			this.device.setProp(this.device.props.SetpointCooling, targetTemperature)
		}
	}
	
	getTemperatureDisplayUnits(property) {
		const units = this.device.getProp(property)
	
		const unitTypes = {
			"C": Characteristic.TemperatureDisplayUnits.CELSIUS,
			"F": Characteristic.TemperatureDisplayUnits.FAHRENHEIT
		}
	
		this.logGet("temperature display units", `degrees ${units}`)

		return unitTypes[units]
	}

	setTemperatureDisplayUnits(property, units) {
		const unitTypes = []
		unitTypes[Characteristic.TemperatureDisplayUnits.CELSIUS] = "C"
		unitTypes[Characteristic.TemperatureDisplayUnits.FAHRENHEIT] = "F"

		this.logSet("temperature display units", unitTypes[units])

		// Note: The thermostat may choose to ignore this
		this.device.setProp(property, unitTypes[units])
	}

	updateTemperatureDisplayUnits(characteristic, units) {
		const unitTypes = {
			"C": Characteristic.TemperatureDisplayUnits.CELSIUS,
			"F": Characteristic.TemperatureDisplayUnits.FAHRENHEIT
		}
	
		this.logUpdate("temperature display units", `degrees ${unitTypes[units]}`)

		characteristic.updateValue(unitTypes[units])
	}

	getCurrentRelativeHumidity(property) {
		let humidity = this.device.getProp(property)
		humidity = Math.round(humidity)

		this.logGet("current relative humidity", humidity, "%")

		return humidity
	}

	updateCurrentRelativeHumidity(characteristic, humidity) {
		humidity = Math.round(humidity)

		this.logUpdate("current relative humidity", humidity, "%")

		characteristic.updateValue(humidity)
	}

	getHeatingThresholdTemperature(property) {
		let heatingTemperature = this.device.getProp(property)
		heatingTemperature = this.toHomekitTemperature(heatingTemperature)
	
		this.logGet("heating threshold temperature", heatingTemperature, "° C")

		return heatingTemperature
	}

	setHeatingThresholdTemperature(property, temperature) {
		this.logSet("heating threshold temperature", temperature, "° C")
	
		const mode = this.device.getProp(this.device.props.Mode)
		if (mode == "Auto") {
			// This property should only be set in Auto mode
			const heatingTemperature = this.toAlmondTemperature(temperature)
			this.device.setProp(property, heatingTemperature)
		}
	}

	updateHeatingThresholdTemperature(characteristic, temperature) {
		const heatingTemperature = this.toHomekitTemperature(temperature)

		this.logUpdate("heating threshold temperature", heatingTemperature, "° C")
		characteristic.updateValue(heatingTemperature)

		const mode = this.device.getProp(this.device.props.Mode)
		if (mode == "Heat") {
			this.logUpdate("target temperature", heatingTemperature, "° C")
			this.Thermostat.TargetTemperature.updateValue(heatingTemperature)
		}
	}

	getCoolingThresholdTemperature(property) {
		let coolingTemperature = this.device.getProp(property)
		coolingTemperature = this.toHomekitTemperature(coolingTemperature)

		this.logGet("cooling threshold temperature", coolingTemperature, "° C")

		return coolingTemperature
	}
	
	setCoolingThresholdTemperature(property, temperature) {
		this.logSet("cooling threshold temperature", temperature, "° C")

		const mode = this.device.getProp(this.device.props.Mode)
		if (mode == "Auto") {
			// This property should only be set in Auto mode
			const coolingTemperature = this.toAlmondTemperature(temperature)
			this.device.setProp(property, coolingTemperature)
		}
	}

	updateCoolingThresholdTemperature(characteristic, temperature) {
		const coolingTemperature = this.toHomekitTemperature(temperature)

		this.logUpdate("cooling threshold temperature", coolingTemperature, "° C")
		characteristic.updateValue(coolingTemperature)

		const mode = this.device.getProp(this.device.props.Mode)
		if (mode == "Cool") {
			this.logUpdate("target temperature", coolingTemperature, "° C")
			this.Thermostat.TargetTemperature.updateValue(coolingTemperature)
		}
	}

	getOn(property) {
		const fanMode = this.device.getProp(property)

		this.logGet("fan mode", fanMode)

		return fanMode == "On Low"
	}

	setOn(property, state) {
		this.logSet("fan mode", state)

		this.device.setProp(property, state ? "On Low" : "Auto Low")
	}

	updateOn(characteristic, mode) {
		this.logUpdate("fan mode", mode)

		characteristic.updateValue(mode == "On Low")
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

	getContactSensorState(property) {
		let state = this.device.getProp(property)
		state = Number(state)

		const states = [
			Characteristic.ContactSensorState.CONTACT_DETECTED,
			Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
		]

		this.logGet("contact state", states[state])

		return states[state]
	}

	updateContactSensorState(characteristic, state) {
		state = Number(state)

		const states = [
			Characteristic.ContactSensorState.CONTACT_DETECTED,
			Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
		]

		this.logUpdate("contact state", states[state])

		characteristic.updateValue(states[state])
	}

	getStatusTampered(property) {
		let state = this.device.getProp(property)
		state = Number(state)

		const states = [
			Characteristic.StatusTampered.NOT_TAMPERED,
			Characteristic.StatusTampered.TAMPERED
		]

		this.logGet("tamper state", states[state])

		return states[state]
	}

	updateStatusTampered(characteristic, state) {
		state = Number(state)

		const states = [
			Characteristic.StatusTampered.NOT_TAMPERED,
			Characteristic.StatusTampered.TAMPERED
		]

		this.logUpdate("tamper state", states[state])

		characteristic.updateValue(states[state])
	}

	getStatusLowBattery(property) {
		let state = this.device.getProp(property)
		state = Number(state)

		const states = [
			Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
			Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
		]

		this.logGet("low battery state", states[state])

		return states[state]
	}

	updateStatusLowBattery(characteristic, state) {
		state = Number(state)

		const states = [
			Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
			Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
		]

		this.logUpdate("low battery state", states[state])

		characteristic.updateValue(states[state])
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

	getSmokeDetected(property) {
		let state = this.device.getProp(property)
		state = Number(state)

		const states = [
			Characteristic.SmokeDetected.SMOKE_NOT_DETECTED,
			Characteristic.SmokeDetected.SMOKE_DETECTED
		]
	
		this.logGet("smoke detection state", states[state])

		return states[state]
	}

	updateSmokeDetected(characteristic, state) {
		state = Number(state)

		const states = [
			Characteristic.SmokeDetected.SMOKE_NOT_DETECTED,
			Characteristic.SmokeDetected.SMOKE_DETECTED
		]
	
		this.logUpdate("smoke detection state", states[state])

		characteristic.updateValue(states[state])
	}

	getStatusTampered(property) {
		let state = this.device.getProp(property)
		state = Number(state)

		const states = [
			Characteristic.StatusTampered.NOT_TAMPERED,
			Characteristic.StatusTampered.TAMPERED
		]

		this.logGet("tamper state", states[state])

		return states[state]
	}

	updateStatusTampered(characteristic, state) {
		state = Number(state)

		const states = [
			Characteristic.StatusTampered.NOT_TAMPERED,
			Characteristic.StatusTampered.TAMPERED
		]

		this.logUpdate("tamper state", states[state])

		characteristic.updateValue(states[state])
	}

	getStatusLowBattery(property) {
		let state = this.device.getProp(property)
		state = Number(state)

		const states = [
			Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
			Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
		]

		this.logGet("low battery state", states[state])

		return states[state]
	}

	updateStatusLowBattery(characteristic, state) {
		state = Number(state)

		const states = [
			Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
			Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
		]

		this.logUpdate("low battery state", states[state])

		characteristic.updateValue(states[state])
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

	getSmokeDetected(property) {
		let state = this.device.getProp(property) > 0
		state = Number(state)

		const states = [
			Characteristic.SmokeDetected.SMOKE_NOT_DETECTED,
			Characteristic.SmokeDetected.SMOKE_DETECTED
		]
	
		this.logGet("smoke detection state", states[state])

		return states[state]
	}

	updateSmokeDetected(characteristic, state) {
		state = Number(state > 0)

		const states = [
			Characteristic.SmokeDetected.SMOKE_NOT_DETECTED,
			Characteristic.SmokeDetected.SMOKE_DETECTED
		]

		this.logUpdate("smoke detection state", states[state])

		characteristic.updateValue(states[state])
	}
}

class AlmondGarageDoorOpener extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device)

		this.setupCharacteristics("GarageDoorOpener", [
			["CurrentDoorState", "BarrierOperator"],
			["TargetDoorState", "BarrierOperator"],
			["ObstructionDetected", "BarrierOperator"]
		])

		this.logServiceCount()
	}

	getCurrentDoorState(property) {
		const states = {
			0: Characteristic.CurrentDoorState.CLOSED,
			252: Characteristic.CurrentDoorState.CLOSING,
			253: Characteristic.CurrentDoorState.STOPPED,
			254: Characteristic.CurrentDoorState.OPENING,
			255: Characteristic.CurrentDoorState.OPEN
		}

		const state = this.device.getProp(property)

		this.logGet("current door state", states[state])

		return states[state]
	}

	updateCurrentDoorState(characteristic, state) {
		const states = {
			0: Characteristic.CurrentDoorState.CLOSED,
			252: Characteristic.CurrentDoorState.CLOSING,
			253: Characteristic.CurrentDoorState.STOPPED,
			254: Characteristic.CurrentDoorState.OPENING,
			255: Characteristic.CurrentDoorState.OPEN
		}

		this.logUpdate("current door state", states[state])

		characteristic.updateValue(states[state])
	}

	getTargetDoorState(property) {
		let targetState
		if (this.device._targetDoorState !== undefined) {
			targetState = this.device._targetDoorState
		} else {
			const currentState = this.device.getProp(property)
			switch (currentState) {
				case 0:
				case 252:
					targetState = Characteristic.TargetDoorState.CLOSED
					break
				case 254:
				case 255:
					targetState = Characteristic.TargetDoorState.OPEN
					break
				default:
					// Not sure if this is the best default, but we have to give an answer
					targetState = Characteristic.TargetDoorState.CLOSED
			}
		}

		this.logGet("target door state", targetState)

		return targetState
	}

	setTargetDoorState(property, state) {
		this.logSet("target door state", state)

		const states = []
		states[Characteristic.TargetDoorState.OPEN] = 255
		states[Characteristic.TargetDoorState.CLOSED] = 0

		this.device.setProp(property, states[state])
	}

	updateTargetDoorState(characteristic, state) {
		let newState

		switch (state) {
			case 0:
			case 252:
				newState = Characteristic.TargetDoorState.CLOSED
				break
			case 254:
			case 255:
				newState = Characteristic.TargetDoorState.OPEN
		}

		if (newState !== undefined) {
			this.logUpdate("target door state", newState)

			characteristic.updateValue(newState)
		}
	}

	getObstructionDetected(property) {
		let obstruction = this.device.getProp(property) == 253
	
		this.logGet("obstruction state", obstruction)

		return obstruction
	}

	updateObstructionDetected(characteristic, state) {
		let newState

		switch (state) {
			case 0:
			case 255:
				newState = false
				break
			case 253:
				newState = true
		}

		if (newState !== undefined) {
			this.logUpdate("obstruction state", newState)

			characteristic.updateValue(newState)
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

	getOn(property) {
		const state = this.device.getProp(property) > 0

		this.logGet("state", state)

		return state
	}
	
	setOn(property, state) {
		this.logSet("state", state)

		const oldSpeed = this.device.getProp(property)
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

		this.device.setProp(property, newSpeed)
	}

	updateOn(characteristic, speed) {
		if (speed >= 0 && speed <= 100) {
			const state = speed > 0

			this.logUpdate("state", state)

			characteristic.updateValue(state)
		}
	}

	getRotationSpeed(property) {
		const speed = this.device.getProp(property)

		this.logGet("rotation speed", speed, "%")

		return speed
	}
	
	setRotationSpeed(property, speed) {
		this.logSet("rotation speed", speed, "%")

		if (speed > 0 && speed <= 100) {
			this._cachedSpeed = speed
		}

		this.device.setProp(property, speed)
	}

	updateRotationSpeed(characteristic, speed) {
		if (speed > 0 && speed <= 100) {
			this.logUpdate("rotation speed", speed, "%")
	
			this._cachedSpeed = speed
			characteristic.updateValue(speed)
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

	getOn(property) {
		let state = this.device.getProp(property)
	
		this.logGet("state", state)

		return state
	}

	setOn(property, state) {
		this.logSet("state", state)

		this.device.setProp(property, state)
	}

	updateOn(characteristic, state) {
		this.logUpdate("state", state)

		characteristic.updateValue(state)
	}
}

class AlmondOutlet extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device)

		this.setupCharacteristics("Outlet", [
			["On", "SwitchBinary"],
			["OutletInUse", "SwitchBinary"]
		])

		this.logServiceCount()
	}

	getOn(property) {
		const state = this.device.getProp(property)

		this.logGet("state", state)

		return state
	}

	setOn(property, state) {
		this.logSet("state", state)
	
		this.device.setProp(this.device.props.SwitchBinary, state)
	}

	updateOn(characteristic, state) {
		this.logUpdate("state", state)

		characteristic.updateValue(state)
	}

	getOutletInUse(property) {
		const state = this.device.getProp(property)

		this.logGet("usage state", state)

		return state
	}

	updateOutletInUse(characteristic, state) {
		this.logUpdate("usage state", state)

		characteristic.updateValue(state)
	}
}

class AlmondClick extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device)

		this.setupCharacteristics("StatelessProgrammableSwitch", [
			["ProgrammableSwitchEvent", "Press"],
			["StatusLowBattery", "LowBattery"]
		])

		this.logServiceCount()
	}

	getProgrammableSwitchEvent(property) {
		const press = this.device.getProp(property)

		this.logGet("press", press)

		const events = {
			3: Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
			0: Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS,
			2: Characteristic.ProgrammableSwitchEvent.LONG_PRESS
		}

		return events[press]
	}

	updateProgrammableSwitchEvent(characteristic, press) {
		this.logUpdate("press", press)

		const events = {
			3: Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
			0: Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS,
			2: Characteristic.ProgrammableSwitchEvent.LONG_PRESS
		}

		characteristic.updateValue(events[press])
	}

	getStatusLowBattery(property) {
		const status = this.device.getProp(property)
			? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
			: Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL

		this.logGet("low battery state", status)

		return status
	}

	updateStatusLowBattery(characteristic, status) {
		status = status
			? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
			: Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL

		this.logGet("low battery state", status)

		characteristic.updateValue(status)
	}
}

/*
class Almondx extends AlmondAccessory {
	constructor(log, accessory, device) {
		super(log, accessory, device)


	}
}
*/