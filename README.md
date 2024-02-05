# Home Assistant Bose Connector


[Home Assistant](https://www.home-assistant.io/)
Creates a connector to broker data between a Bose CSP and Home Assistant



## Important Info

* This does not run within the Home Assistant system. I currently run it on a Raspberry Pi

  
## Config Steps

Create a user in HomeAssistant to broker the data, this is used to help determine if changes were made by a homeassistant user vs the connector
Create a Long Lived Token

Each zone needs the following:

-Helper Input Number (Volume)
-Helper Boolean (Mute)
-Helper Select (Audio Source)

They should follow the following name syntax

-input_number.bose_volume_***name***
-input_select.bose_source_***name***
-input_boolean.bose_mute_***name***


