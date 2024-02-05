const WebSocket = require('ws');
const ms = require('ms');

class HassWS {
	constructor(options = {}) {

		this.zones = options.zones || false;
		
		this.host = options.host || false;
		this.port = options.port || 8123;	
		this.userID = options.userID || null;
		this.connected = false;
		this.connectionTimeout = options.connectionTimeout || 5000;
		
		this.autoReconnect = options.autoReconnect || true;
		this.reconnectCount = 0;
		
		this.authorized = false;
		
		this.accessToken = options.accessToken || false;	
		this.socketURL = 'ws://'+ this.host + ':' + this.port + '/api/websocket';
		this.hassIDInc = 1;
		
		this.debug = options.debug || 0; // do we console log? 1 == mild 2 == everything
		
		
		this.entityInclusion  = Object.entries(this.zones).flatMap(([key, value]) => {
			const cleanZone = value.toLowerCase().replace(/\s/g, '');
			return [
            	`input_number.bose_volume_${cleanZone}`,
				`input_select.bose_source_${cleanZone}`,
				`input_boolean.bose_mute_${cleanZone}`];
		});
		
		
		this.connect();
		
		//make sure ping pong is always working
		setInterval(() => this.pingPongUptime(), 10000);
	}
	
	connect() {
		if(this.debug > 0) console.log('HASS WebSocket:  Attempting to Connect to HomeAssistant');
		
        this.HassClient = new WebSocket(this.socketURL);
		
		//handle timeouts for connecting
        setTimeout(() => {
            if (!this.connected) {
                console.log('HASS WebSocket: WebSocket connection timed out');
				this.close();
                // Handle timeout, such as retrying the connection or displaying an error message
				
				//this.reconnect()
            }
        }, this.connectionTimeout);

        this.HassClient.onopen = () => {
            this.connected = true;
			this.reconnectCount = 0; 
			
            this.authorized = false; // Re-authenticate after reconnecting
            this.authHASS();
        };
		
		this.HassClient.onmessage = (event) => {
		  
		  this.connected = true;

		  this.processData(event.data);
	    };

	    this.HassClient.onclose = (event) => {
	      if(this.debug > 0) console.log('HASS WebSocket:  connection closed');
		  if(this.debug > 1) console.log(event);

		  //reset for next one
		  this.connected = false;
		  this.authorized = false;
          
		  //run the auto reconnect
		  if(this.autoReconnect) this.reconnect();
		  
		  //if your connector wants to know about this
		  if(this.onCloseCallback) this.onCloseCallback(event);
	    };
	
	    this.HassClient.onerror = (error) => {
		  //this.connected = false;
	      if(this.debug > 1) console.error('WebSocket encountered an error:', error);
	      // Handle errors in the WebSocket connection
	    };
		
	}
	
	reconnect() {
		  //variable timeout 
		  if (this.reconnectCount < 3) {
		  	var reconnectTimeout = 3000;
		  } else if (this.reconnectCount < 6) {
		  	var reconnectTimeout = 6000;
		  } else if (this.reconnectCount < 10) {
		  	var reconnectTimeout = 60000;
		  } else {
		  	var reconnectTimeout = 3600000;
		  }
		  
		  if(this.debug > 0) console.log('HASS WebSocket:  Reconnect.. Waiting… '+ ms(reconnectTimeout) );
		  setTimeout(() => {
			if(this.debug > 0) console.log('HASS WebSocket:  Reconnecting Starting…');
			//let's restart this shit show
			this.connect();
			
			this.reconnectCount++;
		  }, reconnectTimeout);
	
	}
	
	
	close() {
		if(this.debug > 0) console.log('HASS WebSocket:  Force Close Websocket');
		this.connected = false;
        this.HassClient.close();
        clearTimeout(this.pingPongTimeout);
    	
	}
		
	authHASS() {
		this.lastAuthAttempt = Date.now();
		
		// Authenticate with the access token
		this.HassClient.send(JSON.stringify({ type: 'auth', access_token: this.accessToken }));

    	// Subscribe to state change events
		
		setTimeout(() => {
			this.HassClient.send(JSON.stringify({ id: 1, type: 'subscribe_events', event_type: 'state_changed' }));
		}, 1000);
		
		
		
		//start the ping pong show
		setTimeout(() => {
			this.sendHandler({type: 'ping' });
		}, 1500);
		
		
		
	}
	
	pingPong() {
		if (!this.connected) return; 
		
		if(this.debug > 1) console.log("HASS WebSocket: PING PONG FUNC");	
		
		this.pingPongLast = Date.now();
		
		setTimeout(() => {
			this.sendHandler({type: 'ping' });
		
		}, 4000);
		
		if(this.pingPongTimeout) clearTimeout(this.pingPongTimeout);

		this.pingPongTimeout = setTimeout(() => {
			if(this.debug > 0) console.log("HASS WebSocket: NO PONG TO MY PING, CLOSING WEBSOCKET");	
			this.close();		
		}, 10000);
	
	}
	
	//this monitors the last pong from the server, if it's been a while, send a new ping over to startup the ping pong
	pingPongUptime() {
		 if (this.connected && Date.now() - (this.pingPongLast ?? 0) > 10000) {
			if(this.debug > 0) console.log("HASS WebSocket: No Ping Pong For a bit!! Start a New Ping");
			
			this.sendHandler({type: 'ping' });
		}
	}
	
	processData(message) {
	    const data = JSON.parse(message);
		
		if(this.debug > 2) console.log(message);
		

		if (data.type == 'pong' || data.type == 'ping') this.pingPong();
		
		
	    if (data.type === 'auth_required') {
	      if(this.debug > 0) console.log('HASS WebSocket: Authentication required');
		  this.authHASS();
	    } else if (data.type === 'auth_ok') {
	      if(this.debug > 0) console.log('HASS WebSocket: Authentication successful');
		  this.authorized = true;
	    } else if (data.type === 'auth_invalid') {
	      if(this.debug > 0) console.log('HASS WebSocket: Authentication failed:' + data.message);
		  
		  process.exit();
	    } else if (data.type === 'event') {
	
	      
	    	const { event } = data;
			const { entity_id, new_state } = event.data;
		  
		  
		  	if(event.context.user_id == this.userID) {
		  		if(this.debug > 1 )console.log("HASS WebSocket:  Ignore - Data We just Sent");
			}else if (event.event_type === 'state_changed' && this.entityInclusion.includes(entity_id)) {

			  	const entityIdParts = entity_id.split('.');
	  			
				switch (entityIdParts[0]) {
					case 'input_number':
						
					    var type = 'volume';
						
						if (new_state.state< -60 || new_state.state > 12) {
							console.error(`Volume out of range for entity ID: ${entityId}`);
							return;
						}
						
						break;
					case 'input_boolean':
					    var type = 'mute';
						break;
					case 'input_select':
					    var type = 'source';
						break;
					default:
					    console.error(`Invalid entity type: ${entityIdParts[0]}`);
						return;
				}
				
				this.newValuesCallback({zone: entityIdParts[1], type: type, value: new_state.state});
				
				
			}
	
		  	
	    }
	}
	sendHandler(data) {
		data.id = this.hassIDInc++;
		
		var stringToSend = JSON.stringify(data);
		
		this.HassClient.send(stringToSend);
	}

	writeUpdate(data) {
		
		//if we send data before auth, fails
		if(!this.authorized) {
			if(this.debug > 0) console.log("HASS WebSocket:  Not Authorized - Cancelling");
			return
		}
		
		if(data.value == null) {
			if(this.debug > 0) console.log("HASS WebSocket:  NULL Data - Cancelling Write to HASS");
			return
		}
		
		if(this.debug > 1) console.log("HASS WebSocket: Writing New Data to HASS - "+JSON.stringify(data));
		
	    const cleanZone = data.zone.toLowerCase().replace(/\s/g, '');
	
	    switch(data.type) {
	      case 'volume':
	        var domain = 'input_number';
	        var service = 'set_value';
	        var entityId = `${domain}.bose_volume_${cleanZone}`;
	        break;
	      case 'mute':
	        var domain = 'input_boolean';
	        var service = (this.value == 'on') ? 'turn_on' : 'turn_off';
	        var entityId = `${domain}.bose_mute_${cleanZone}`;
	        break;
	      case 'source':
	        var domain = 'input_select';
	        var service = 'select_option';
	        var entityId = `${domain}.bose_source_${cleanZone}`;
	        break;
	      default:
	        console.error(`Invalid type: ${type}`);
	        return;
	    }
		
		
		var serviceData = {};
    
	    if (data.type === 'volume') {
		  serviceData = {
		    entity_id: entityId,
		    value: data.value
		  };
	    } else if (data.type === 'mute') {
			serviceData = {
				entity_id: entityId
			};
		} else if (data.type === 'source') {
			serviceData = {
				entity_id: entityId,
				option: data.value
			};			
		} else {
			if(this.debug > 0) console.log("HASS WebSocket:  ERROR: No Type Case");
			return;
		}
	
	    const yamlData = JSON.stringify({
	      id: this.hassIDInc++,
	      type: 'call_service',
	      domain: domain,
	      service: service,
	      service_data: serviceData,
	    });
	
	    if(this.debug > 1) console.log("HASS WebSocket:  sendHelperValue: " + yamlData);
	
	    this.HassClient.send(yamlData);
		
		
	}
	
	
	
	onNewValues(callback) {
		this.newValuesCallback = callback;
	}
	
	
}


module.exports = HassWS;
