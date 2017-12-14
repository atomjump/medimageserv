/*
  Installation
	npm install uuid
	Copy config/sessionsORIGINAL.json to config/sessions.json
  
  Call with params:
    'pass' 			- will check this against the system password in config/sessions.json. If correct, will give the user a session id (which their
    					browser stores in a cookie). We store this session id in the sessions.json file for future checks.
    					Returns json { "success": true, "sessionId": "SAKF34tsgkj56" }
    
    OR
    
    'sessionId'		- will check this session id exists, and returns json { "success": true } if so. { "success": false } if not.
  
   Note, currently sessions don't expire.  In future, we need a logout facility.
    
*/


var fs = require('fs');
var uuidv4 = require('uuid/v4');
var path = require('path');
var queryString = require('querystring');
global.globalRAMSessionConfig = null;		//Completely global


var verbose = false;

//Globals
var readConfigFile = __dirname + '/config/sessions.json';

var MY_NAMESPACE = "27e692ae-8e59-4f35-ba87-0688c60a2287";


function generateSession(conf) {
	//Add a new session and return it
	var sessionId = uuidv4();		//Generate a random var
	globalRAMSessionConfig.sessions.push(sessionId);
	globalRAMSessionConfig.updated = true;
	return sessionId;
}



function writeConfig(confFile, content, cb) {
	//Note: we store the sessions in RAM, and only write them every now and then
	//Write the file nicely formatted again
	fs.writeFile(confFile, JSON.stringify(content, null, 6), function(err) {
		if(err) {
			console.log("Error writing config file: " + err);
			cb(err);
			
		} else {
		
			console.log("The config file was saved! " + confFile);

		
			cb(null);
		}
	});
}


function readConfig(confFile, cb) {
	//Reads and updates config with a newdir in the output photos - this will overwrite all other entries there
	//Returns cb(err) where err = null, or a string with the error


	if(!globalRAMSessionConfig) {

		//Write to a json file with the current drive.  This can be removed later manually by user, or added to
		fs.readFile(confFile, function read(err, data) {
			if (err) {
				//Create our own config
				globalRAMSessionConfig = {
				   viewPassword: "changeme",
				   sessions: []
				}
				cb(globalRAMSessionConfig, null);
		
			} else {
				globalRAMSessionConfig = JSON.parse(data);		//Note: TODO if data is an 'undefined' value this function will break


				cb(globalRAMSessionConfig, null);
			};
		});
	} else {
		cb(globalRAMSessionConfig, null);
	}

}



function request(argv, cb) {


		var param = decodeURIComponent(argv);

		var resp = {
			"success": false	
		};
	

		var opts = queryString.parse(param);	
		
		readConfig(readConfigFile, function(conf, err) {

		   if(err) {
			 var resp = {
				"success": false,
				"error": err	   	 
			 };
			 console.log("Error reading config file:" + err);
			 cb(err, "returnParams:?CUSTOMJSON=" + encodeURIComponent(JSON.stringify(resp)));
		 
		   } else {
				//We have read the config file ok
					if(opts.pass) {
						//We have passed through a password
						//Check it is correct
						
var passw = conf.viewPassword;
if(globalConfig && globalConfig.basicAuthent) passw = globalConfig.basicAuthent;
						if(passw === opts.pass) {
							//Logged in OK!
						
							var sessionId = generateSession(conf);
						
							resp = {
								"success": true,
								"sessionId": sessionId
							};
						
						
							cb(null, "returnParams:?CUSTOMJSON=" + encodeURIComponent(JSON.stringify(resp)));
					
						} else {
							//Incorrect password
							resp = {
								"success": false,
								"error": "Sorry, that is the wrong password."
							};
						
							cb(null, "returnParams:?CUSTOMJSON=" + encodeURIComponent(JSON.stringify(resp)));
						}
					} else {
						//Checking this session id exists
						if(opts.sessionId) {
					
							if(opts.logout) {
								var ind = module.exports.checkSessionValid(opts.sessionId) 
								
								if(ind > -1) {
									//Delete the session
									globalRAMSessionConfig.sessions.splice(ind,1);
									globalRAMSessionConfig.updated = true;
									
									resp = { "success": true };
									cb(null, "returnParams:?CUSTOMJSON=" + encodeURIComponent(JSON.stringify(resp)));
								} else {
									resp = { "success": false };
									cb(null, "returnParams:?CUSTOMJSON=" + encodeURIComponent(JSON.stringify(resp)));
								}
							
							
							} else {
								
								if(module.exports.checkSessionValid(opts.sessionId) > -1) {
									//Exists
									resp = { "success": true };
									cb(null, "returnParams:?CUSTOMJSON=" + encodeURIComponent(JSON.stringify(resp)));
								} else {
									//Nope, doesn't exist
									resp = { "success": false };
									cb(null, "returnParams:?CUSTOMJSON=" + encodeURIComponent(JSON.stringify(resp)));
								}
							}
					
						} else {
							var msg = "You need to pass a parameter, either 'pass' or 'sessionId'. Opts:" + JSON.stringify(opts);
							var resp = {
								"success": false,
								"error": msg    	 
							 };
			 				 cb(err, "returnParams:?CUSTOMJSON=" + encodeURIComponent(JSON.stringify(resp)));
						
						}					
					}

				
			}
		});			

}


//Set up a regular timer to write out the config file, if it has been set
	
function doRegular(cb) {
	if(globalRAMSessionConfig) {
		if(globalRAMSessionConfig.updated == true) {
			
			//Don't need to keep writing to disk, unless there is a new session
			globalRAMSessionConfig.updated = false;	
			writeConfig(readConfigFile, globalRAMSessionConfig, function(err) {
			
				if(err) {
					console.log("There was an error writing the session data: " + err);
					globalRAMSessionConfig.updated = true;		//Try again	
					return;
				} else {
					return;															
				}
			});		
		}
	
	}
}

var regular = setInterval(doRegular, 5000);		//Check every 5 seconds





module.exports = { 
	medImage : function(argv, callback) {


			request(argv[0], function(err, output) {

				
				var ret = {};
				ret.err = "";
				ret.stdout = output;
				ret.stderr = "";
			
				callback(err, ret);
			});
		

	
	},	
	checkSessionValid: function(sessionId) {
		//Returns index of session if valid (i.e. > -1), or -1 if invalid
	
		//Check performance of indexOf, we may need an array query here - if we had thousands of sessions it could be too slow. Although it is a RAM check.
		if((globalRAMSessionConfig) && (globalRAMSessionConfig.sessions)) {
			return globalRAMSessionConfig.sessions.indexOf(sessionId);
		} else {
			return -1;	
		}			
	}
}
