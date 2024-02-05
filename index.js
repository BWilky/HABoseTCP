// In your main Node.js file

const BoseTCP = require('./bosetcp');
const HassWS = require('./hass');

const MIN_VOLUME =  -60;
const MAX_VOLUME = 12;
const WAIT_TIME = 5000; // 5 seconds in milliseconds



//audio zone data translations
const audioZones = {
	'bose_diningroom': 'DiningRoom',
	'bose_pavilion': 'Pavilion',
	'bose_foyer': 'Foyer',
	'bose_lounge': 'Lounge'
}




//new Bose TCP object
BoseDiningRoom = new BoseTCP({
	zones: audioZones,
	host: '10.50.0.70',
	port: 10055,
	audioSourceList: ['wireless mic','sonos','aux cable','mix'],
	debug: 1
});


BoseDiningRoom.onNewValues((data) => {
	
	if(BarnabasHASS.connected) {
		console.log("Connector->New Data:" + JSON.stringify(data) );
		BarnabasHASS.writeUpdate(data);
	} else {
		console.log("Ignoring New Data From BOSE TCP - HASS Disconnected");
	}

});






BarnabasHASS = new HassWS({
	host: '****',
	accessToken: '*****',
	userID: '******',
	zones: audioZones,
	debug: 1
});
	
//data 
BarnabasHASS.onNewValues((data) => {
	
	//check if BOSE is even up, if it is, kick back
	if(BoseDiningRoom.connected) {
		console.log("New Data From HASS:" + JSON.stringify(data) );
		BoseDiningRoom.write(data.zone, data.type, data.value);
	} else {
		console.log("Ignoring New Data From HASS - BOSE TCP DISCONNECTED");
	}
	
	
});



