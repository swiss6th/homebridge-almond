"use strict";

var Almond = require('almond-client'),
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
    this.log("Got device. Name:%s, ID:[%s], Type:%s", device.name, device.id, device.type)

	if(device.props === undefined){
		this.log("	Device not supported.");
		return;
	}
	
	switch(device.type){
	case '4':
		/*LightBulb with dimmer*/
		this.log("	+Service.Lightbulb");
    	services.push(Service.Lightbulb);
		break;
	case '13':
		/*Fire sensor*/
		this.log("	+Service.SmokeSensor");
		services.push(Service.SmokeSensor);
		break;
	case '12':
		/*Contact sensor*/
		this.log("	+Service.ContactSensor");
		services.push(Service.ContactSensor);
		/*ToDo: test for temperature sensor service*/
		break;
	default:
		this.log("	+Service.SwitchBinary");
		if (device.props.SwitchBinary !== undefined) {
    	/*Fallback to Switch*/
        services.push(Service.Switch);
    	}
	}
    

    if (services.length === 0) {
        this.log("	No services supported: %s [%s]", device.name, device.type);
        return;
    }

    this.log("	Found %s services.", services.length);

    var uuid = UUIDGen.generate('AlmondDevice: '.concat(device.id));

    var accessory = this.accessories[uuid];
    if (accessory === undefined) {
        var accessory = new Accessory(device.name, uuid);
        this.api.registerPlatformAccessories("homebridge-platform-almond", "Almond", [accessory]);
    }
    
   
var nameappend='';
    for(var srvc in services) {
    var service = services[srvc];
		if (accessory.getService(service) == undefined) {
		    
			if(service == Service.Lightbulb){
			this.log("	gotta light?");
				accessory.addService(service, device.name+nameappend).addCharacteristic(Characteristic.Brightness);
			}else if(service == Service.SmokeSensor)
			{
				var sv= accessory.addService(service, device.name+nameappend)
					sv.addCharacteristic(Characteristic.StatusLowBattery);
					sv.addCharacteristic(Characteristic.StatusTampered);
			}else if(service == Service.ContactSensor)
			{
				var sv= accessory.addService(service, device.name+nameappend)
					sv.addCharacteristic(Characteristic.StatusLowBattery);
					sv.addCharacteristic(Characteristic.StatusTampered);
			
			}
			else if( service == Service.Switch){
                accessory.addService(service, device.name+nameappend);
                if(device.type==43)
                {
                nameappend= " Switch 2";
                accessory.addService(service, device.name+nameappend);
                }
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
    for(var key in this.accessories) {
        var accessory = this.accessories[key];
        this.log("Checking existance of %s:", accessory.displayName);
        if (!(accessory instanceof AlmondAccessory)) {
            this.log("	(-)Did not find device for accessory %s so removing it.", accessory.displayName);
            this.api.unregisterPlatformAccessories("homebridge-platform-almond", "Almond", [accessory]);
            delete this.accessories[key];
        }else{
        this.log("	(+)Device exist.");
        }
    }
}

function AlmondAccessory(log, accessory, device) {
    var self = this;
    this.accessory = accessory;
    this.device = device;
    this.log = log;

    this.displayName = this.accessory.displayName;

    this.log("	Setting up: %s", accessory.displayName);
    
    this.updateReachability(true);

    this.accessory.getService(Service.AccessoryInformation)
        .setCharacteristic(Characteristic.Manufacturer, device.manufacturer)
        .setCharacteristic(Characteristic.Model, device.model);
  
    this.accessory.on('identify', function(paired, callback) {
        self.log("	%s - identify", self.accessory.displayName);
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

AlmondAccessory.prototype.addEventHandlers = function (device) {
    var self = this;
    var servicecount = 0;

    var service = this.accessory.getService(Service.Switch);
    if (service !== undefined) {
        servicecount++;

        service.getCharacteristic(Characteristic.On).on('set', this.setSwitchState.bind(this)).on('get', this.getSwitchState.bind(this));
        
        if(this.device.type=='43'){
            service = this.accessory.getService(device.name+" Switch 2");

            if (service !== undefined){
            service.getCharacteristic(Characteristic.On).on('set', this.setSwitchState2.bind(this)).on('get', this.getSwitchState2.bind(this));
            }
        }
    }
    
    service = this.accessory.getService(Service.Lightbulb);
    if (service !== undefined) {
        servicecount++;

        service.getCharacteristic(Characteristic.Brightness).on('set', this.setBrightness.bind(this)).on('get', this.getBrightness.bind(this));
        service.getCharacteristic(Characteristic.On).on('set', this.setSwitchState.bind(this)).on('get', this.getSwitchState.bind(this));
    }

    service = this.accessory.getService(Service.SmokeSensor);
    if (service !== undefined) {
        servicecount++;

        service.getCharacteristic(Characteristic.SmokeDetected).on('get', this.getStateState.bind(this));
        service.getCharacteristic(Characteristic.StatusTampered).on('get', this.getTamperState.bind(this));
        service.getCharacteristic(Characteristic.StatusLowBattery).on('get', this.getLowBatteryState.bind(this));
    }
    
    service = this.accessory.getService(Service.ContactSensor);
    if (service !== undefined) {
        servicecount++;

        service.getCharacteristic(Characteristic.ContactSensorState).on('get', this.getStateState.bind(this));
        service.getCharacteristic(Characteristic.StatusTampered).on('get', this.getTamperState.bind(this));
        service.getCharacteristic(Characteristic.StatusLowBattery).on('get', this.getLowBatteryState.bind(this));
    }


    if (servicecount > 0) {

        this.device.on('valueUpdated', function (prop, value) {
            self.log("Value updated: prop:%s -> value:%s id:[%s]", prop, value, this.id);
            if (this.props.SwitchBinary == prop || this.props.State == prop || this.props.Tamper == prop || this.props.LowBattery == prop) {
            	if (typeof value === 'string')
            	{
                	if (value === 'true' || value === 'false')
                        {
                        	value = value == 'true';
                        	value = (value | 0) ? true : false;
                        }
                
                }

                self.updateBoolState(value, prop);
            }

            if (this.props.SwitchMultilevel == prop) {
                value = Math.round(value * 100 / 255);
                self.updateBrightnessState(value);
            }
        })
    }
}


AlmondAccessory.prototype.getSwitchState = function(cb) {
    var state = this.device.getProp(this.device.props.SwitchBinary);
    
	if (typeof state === 'string') {
	        if (state === 'true' || state === 'false'){
			state= state == 'true';
			}
	}
	state= +state;    
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
	        if (state === 'true' || state === 'false'){
			state= state == 'true';
			}
	}
	state= +state;    
this.log(
        "Getting state for: %s and state is %s [%s]",
        this.accessory.displayName,
        state,
        typeof state
    );
    cb(null, state);
}

AlmondAccessory.prototype.getBrightness = function(cb) {
    var state = this.device.getProp(this.device.props.SwitchMultilevel);
    state= Math.round(state * 100 / 255 );
     
	this.log(
        "Getting brightness state for: %s and state is %s [%s]",
        this.accessory.displayName,
        state,
        typeof state
    );
    cb(null, state);
}

AlmondAccessory.prototype.getStateState = function(cb) {
    var state = this.device.getProp(this.device.props.State);
	if (typeof state === 'string') {
	        if (state === 'true' || state === 'false'){
			state= state == 'true';
			}
	}
	state= +state;    
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
	        if (state === 'true' || state === 'false'){
			state= state == 'true';
			}
	}
	state= +state;    
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
	        if (state === 'true' || state === 'false'){
			state= state == 'true';
			}
	}
	state= +state;    
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
    var value = (state | 0) ? true:false;

    this.device.setProp(this.device.props.SwitchBinary, value, function() {
        if (cb) cb(null);
    });
}
AlmondAccessory.prototype.setSwitchState2 = function(state, cb) {
    this.log("Setting switch [%s] to: %s [%s]", this.accessory.displayName, state, typeof state);
    var value = (state | 0) ? true:false;

    this.device.setProp(this.device.props.SwitchBinary2, value, function() {
        if (cb) cb(null);
    });
}

AlmondAccessory.prototype.setBrightness = function(state, cb) {
    this.log("Setting brightness [%s] to: %s - %s % [%s]", this.accessory.displayName, state * 255 / 100, state, typeof state);
   // var value = (state | 0) ? true:false;

    this.device.setProp(this.device.props.SwitchMultilevel, state * 255 / 100, function() {
       if (cb) cb(null);
    });
}

AlmondAccessory.prototype.updateBoolState = function(value, prop) {

   prop=parseInt(prop, 10);
 
   if(this.device.type=='4'){
   
   		this.log("	Updating Light bulb State to: %s [%s]", value, typeof value);
   		service = this.accessory.getService(Service.Lightbulb);
    	service.getCharacteristic(Characteristic.On).updateValue(value);
    		
   }else if(this.device.type=='13'){

		service = this.accessory.getService(Service.SmokeSensor);
 	
   		switch(prop){

   			case this.device.props.State:
   				this.log("	Updating SmokeSensor state to: %s [%s]", value, typeof value);
   				service.getCharacteristic(Characteristic.SmokeDetected).updateValue(value ?  Characteristic.SmokeDetected.SMOKE_DETECTED: Characteristic.SmokeDetected.SMOKE_NOT_DETECTED);
    			break;
    		case this.device.props.Tamper:
    			this.log("	Updating SmokeSensor tampered to: %s [%s]", value, typeof value);
    			service.getCharacteristic(Characteristic.StatusTampered).updateValue(value ?  Characteristic.StatusTampered.TAMPERED: Characteristic.StatusTampered.NOT_TAMPERED);
    			break;
    		case this.device.props.LowBattery:
    			this.log("	Updating SmokeSensor low battery to: %s [%s]", value, typeof value);
    			service.getCharacteristic(Characteristic.StatusLowBattery).updateValue(value ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW: Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
    			break;
    		
   		}
   }else if(this.device.type=='12')
   {
   		service = this.accessory.getService(Service.ContactSensor);
   		switch(prop){

   			case this.device.props.State:
   				this.log("	Updating ContactSensor state to: %s [%s]", value, typeof value);
   				service.getCharacteristic(Characteristic.ContactSensorState).updateValue(value ?  Characteristic.ContactSensorState.CONTACT_NOT_DETECTED: Characteristic.ContactSensorState.CONTACT_DETECTED);
    			break;
    		case this.device.props.Tamper:
    			this.log("	Updating ContactSensor tampered to: %s [%s]", value, typeof value);
    			service.getCharacteristic(Characteristic.StatusTampered).updateValue(value ?  Characteristic.StatusTampered.TAMPERED: Characteristic.StatusTampered.NOT_TAMPERED);
    			break;
    		case this.device.props.LowBattery:
    			this.log("	Updating ContactSensor low battery to: %s [%s]", value, typeof value ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW: Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
    			service.getCharacteristic(Characteristic.StatusLowBattery).updateValue(value);
    			break;
    		
   		}
   		//test for temperature service
   }
   else
   {
   		this.log("	Updating Switch State to: %s [%s]", value, typeof value);
    	var service = this.accessory.getService(Service.Switch);
    	service.getCharacteristic(Characteristic.On).updateValue(value);
	}

}

AlmondAccessory.prototype.updateBrightnessState = function(value) {
    this.log("	Updating Brightness State to: %s [%s]", value, typeof value);

    var service = this.accessory.getService(Service.Lightbulb);
    service.getCharacteristic(Characteristic.Brightness).updateValue(value);
}

AlmondAccessory.prototype.updateReachability = function(reachable) {
    this.accessory.updateReachability(reachable);
}