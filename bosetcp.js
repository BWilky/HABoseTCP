// bosetcp.js

var net = require('net');
const MessageBuffer = require('./message-buffer');
const ms = require('ms');

class BoseTCP {
	constructor(options = {}) {
		this.zones = options.zones || false;
		
		this.sharedAudioSources = options.audioSourceList ? [null, ...options.audioSourceList] : [null];
		
		this.host = options.host || false;
		this.port = options.port || false;
		
		this.timeout = options.timeout || 5000;
		this.activityTimeout = options.activityTimeout || 5000;
		
		this.autoReconnect = options.autoReconnect || true;
		this.reconnectCount = 0;
		
		this.connected = false;
		this.audioZoneData = {};
		
		
		
		
		this.debug = options.debug || 0; // do we console log? 1 == mild 2 == everything
		
		//build the holder
		for (const zone in this.zones) {
			this.audioZoneData[ this.zones[zone] ] = {
				source: null,
				volume: null,
				mute: null
			}
		}
		
		
		this.connect();
	}
	
	
	

	connect() {
		this.BoseClient = new net.Socket();
		this.received = new MessageBuffer("\r");
		
		if(this.debug > 0) console.log('BOSE TCP: Connecting…');
		
		//start tcp socket timeout, close if timeout
		const connectionTimeout = setTimeout(() => {
			if (!this.connected) {
			    console.log('BOSE TCP: TCP Timeout');
				//force close this connection
				this.close();
			}
		}, this.timeout);
		
		
		//connect logic
		this.BoseClient.connect(this.port, this.host, () => {
			this.connected = true;
			this.reconnectCount = 0; //reset counter
			
			clearTimeout(connectionTimeout); // Clear the timeout since connection succeeded
			
		    if(this.debug > 0) console.log('BOSE TCP: Connected to TCP server');
			
			setTimeout(() => {
				
				if(this.debug > 0) console.log("BOSE TCP: Initial Data Pull");
			
				this.refreshValues("all","all");
			}, 2000);
			
			this.BoseClient.setKeepAlive(true, 10000);
			
		});
		
		
		

		this.BoseClient.on('close', () => this.onClose);	
		this.BoseClient.on('end', () => this.onClose);

		
		// Handle connection errors
		this.BoseClient.on('error', err => {
			if (err.code === 'ETIMEDOUT' || err.code === 'EADDRNOTAVAIL') {
				this.BoseClient.destroy();
			} else {
				console.error('Bose TCP: Connection error:', err);
			}
		});
		

		
		this.BoseClient.on('data', data => this.onTCPData.call(this, data));

		//delay data polling, allow everything to setup and attempt first connect
		setTimeout(() => this.dataPolling(), 5000);
		
		//delay uptime checker, allow for data to come in
		setTimeout(() => this.upTimeChecker(), 5000);
		
		
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
		  
		  console.log("BOSE TCP: Reconnect: Waiting… "+ ms(reconnectTimeout) );
		  setTimeout(() => {
			console.log("BOSE TCP: Reconnecting Starting…");
			//let's restart this shit show
			this.connect();
			
			this.reconnectCount++;
		  }, reconnectTimeout);
	
	}
	
	upTimeChecker() {
		if(this.debug > 1) console.log("BOSE TCP: Uptime Checker….");
		
		//if we have an active timeout, clear it
		if(this.upTimeTimeout) clearTimeout(this.upTimeTimeout);
		
		//end this if we aren't even connected
		if(!this.connected) return;
		
		//if we're over the timeout period
		if (this.connected && Date.now() - (this.lastIncomingTimeStamp ?? 0) > this.activityTimeout) {
			if(this.debug > 0) console.log("BOSE TCP: No TCP Activity for sometime. Killing connection");
			
			this.close();
		} else {
			if(this.debug > 1) console.log("BOSE TCP: Uptime Checker Active and TCP Online");
			
			setTimeout(() => this.upTimeChecker(), 5000);
		}
	}
	

	close() {
		if(this.debug > 0) console.log("BOSE TCP: Manually Closing Connection to TCP");
		this.BoseClient.end(); // Close the connection if timeout is reached
		this.BoseClient.destroy();
		
		this.onClose();
	}
	
	onClose(data) {
		this.connected = false;
		
		this.reconnect();
	}
	
	onTCPData(data) {
		//push data into a buffer to build up a complete message
		
	    this.received.push(data);
		//update timestamp to show recent incoming data aka connected still
		this.lastIncomingTimeStamp = Date.now();
		
		function extractZoneName(StringofData) {
			const splitBy = StringofData.includes("Gain") ? " Gain" : " Selector";
			return StringofData.split(splitBy)[0].split('GA "')[1];
		}
		
		
		while (!this.received.isFinished()) {
			
			let boseData = this.received.handleData();
			
			//if the complete return doesn't include a GA indicator for bose updated data, kill this off
			if (!boseData.includes("GA")) return;
			
			const dataZone = extractZoneName(boseData);
			
			let dataType, newValue;
			if (boseData.includes("Gain")) {
				if (boseData.includes('>1 =')) {
					newValue = Number(boseData.split('>1 =')[1]);
					dataType = "volume";
				} else if (boseData.includes('>2 =')) {
					newValue = boseData.split('>2 =')[1] === 'O' ? 'on': 'off';
					dataType = "mute";
				}
			} else if (boseData.includes("Selector")) {
				const splitData = parseInt(boseData.split('>1 =')[1], 10);
				if (splitData >= 1 && splitData <= 4) {
					newValue = this.sharedAudioSources[splitData];
					dataType = "source";
				}
			}
			

			if (this.audioZoneData[dataZone][dataType] !== newValue) {
				
				this.audioZoneData[dataZone][dataType] = newValue;
				this.audioZoneData[dataZone]['TSUpdate'] = Date.now();		
				
				this.newValuesCallback({zone: dataZone, type: dataType, value: newValue});	
			}
			
				
		}

	}
	
	
	////////////// REFRESH VALUES //////////////////
	refreshValues(specifiedZone = "all", specifiedType = "all") {
		if (!this.connected) return;

		const writeToBoseClient = (zone, type, value) => {
			this.BoseClient.write('GA "' + zone + ' ' + type + '">' + value + ' \r');
		};
		
		for (const zoneLine in this.zones) {
			var zone = this.zones[zoneLine];
			
			if (specifiedZone == "all" || zone == specifiedZone) {
				if (specifiedType == "all" || specifiedType == "volume") {
					writeToBoseClient(zone, "Gain", 1);
				}
				
				if (specifiedType == "all" || specifiedType == "mute") {
					writeToBoseClient(zone, "Gain", 2);
				}
				
				if (specifiedType == "all" || specifiedType == "source") {
					writeToBoseClient(zone, "Selector", 1);
				}
			}
		}
	}
	


	
	dataPolling() {
		
		if(this.DataPollingAlready) return;
		
		if(this.debug > 0) console.log("BOSE TCP: Starting Data Polling");
		
		this.DataPollingAlready = true;
		
		//just the volume
		setInterval(() => {
			if(this.connected){
				this.refreshValues("all", "volume");
			}
		}, 1000);
		
		//just mute source, volume already being done
		setInterval(() => {
			if(this.connected){
				this.refreshValues("all", "mute");
				this.refreshValues("all", "source");
			}
		}, 15000);
	
		//dump to hass everything
		setInterval(() => {
			if(this.connected){
				this.dumpEverything();
			}
		}, 60000);
		
		
		
		if(this.debug > 1) {
			setInterval(() => {
				console.log(this.audioZoneData);
			}, 30000);		
		}

		
		
	}
	
	
	dumpEverything() {
		if (!this.connected) return;
		
		if(this.debug > 1) console.log("BOSE TCP: Dumping Everything to HASS");
		
		for(let zone in this.audioZoneData) {
	
			this.newValuesCallback({zone: zone, type: 'source', value: this.audioZoneData[zone]['source']});
			this.newValuesCallback({zone: zone, type: 'volume', value: this.audioZoneData[zone]['volume']});
			this.newValuesCallback({zone: zone, type: 'mute', value: this.audioZoneData[zone]['mute']});
			
		}
	}
	
	write(zone, type, value) {
		let setString;
		
		/*
		var room = null;
		
		function stringExistsInObject(obj, searchString) {
	        for (let key in obj) {
	            if (typeof obj[key] === 'string' && obj[key].includes(searchString)) {
	                return true;
	            }
	        }
	        return false;
		}*/
		
		function getParameterCaseInsensitive(object, key) {
		  // Convert the provided key to lowercase
		  const asLowercase = key.toLowerCase();
		  // Find the first key in the object that matches the lowercase key
		  const foundKey = Object.keys(object)
		    .find(k => k.toLowerCase() === asLowercase);
		  // Return an array with the case-specific key and parameter data
		  return foundKey ? [foundKey, object[foundKey]] : [null, null];
		}	
				

		//this will find the zone in the audio data case insensitive, in bose tcp we sometimes use caps, homeassistant provides entities in lower case, then lets return the specific casing of the name and the row data
		const [zoneName, zoneData] = getParameterCaseInsensitive(this.audioZoneData, zone.split('_').pop() );
		console.log(zoneName, zoneData);
		

		/* TODO!!!!!!!!
		    Let's trigger a send back of the old data to HASS, maybe an alert to the user too
		    
		*/
		    
		 
		//end function if we can't get zone data 
		if (zoneName == null || zoneData == null) {
			console.log('\x1b[33m%s\x1b[0m', 'BOSE TCP ERROR: Write Value from Hass Failed - Zone does not exist in object — '+ zone + ' — ' + zoneName);  
			return false;
		}
		
		switch (type) {
			case 'volume':
			    let volDB = Number(value);
				setString = `SA "${zoneName} Gain">1=${volDB}\r`;
				
				break;
			case 'mute':
			    let muteCode = value == 'on' ? 'O': 'F';
				setString = `SA "${zoneName} Gain">2=${muteCode}\r`;
				
				break;
			case 'source':
			    let isSource = (element) => element == value;
				let sourceNum = this.sharedAudioSources.findIndex(isSource);
				if (!sourceNum || sourceNum < 0) {
					console.error("ERROR: Bad Source Provided");
					return;
				}
				
				setString = `SA "${zoneName} Selector">1=${sourceNum}\r`;
				break;
			default:
			    console.error(`Invalid type: ${type}`);
				return;
		}
		
		console.log(`Updating ${type} : ${setString}`);
		
		this.BoseClient.write(setString);
	}
	
	onNewValues(callback) {
		this.newValuesCallback = callback;
	}
	
}

module.exports = BoseTCP;
