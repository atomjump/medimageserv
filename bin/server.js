#!/usr/bin/env node
/*

MedImage Server - runs an http server allowing uploads of photos
and downloads from other MedImage Servers.

../config.json contains the settings for this server.

Usage:  node server.js [-verbose]


Testing https connection:
openssl s_client -CApath /etc/ssl/certs -connect yourdomain.com:5566

*/



var multiparty = require('multiparty');
var http = require('http');
var https = require('https');
var util = require('util');
var path = require("path");
var upath = require("upath");
require("date-format-lite");
var mv = require('mv');
var fs = require('fs');
var exec = require('child_process').exec;
var spawn = require('child_process').spawn;
var drivelist = require('drivelist');
var uuid = require('node-uuid');
var fsExtra = require('fs-extra');
var klaw = require('klaw');
var separateReqPool = {maxSockets: 10};
var request = require("request");
var needle = require('needle');
var readChunk = require('read-chunk'); // npm install read-chunk
var fileType = require('file-type');
var shredfile = require('shredfile')();
var queryStringLib = require('querystring');
var async = require('async');
var os = require('os'); 		//For load levels on unix


var verbose = false; 		//Set to true to display debug info
var outdirDefaultParent = '/medimage';		//These should have a slash before, and no slash after.
var outdirPhotos = '/photos';			//These should have a slash before, and no slash after.
var defaultTitle = "image";
var currentDisks = [];
var configFile = __dirname + '/../config.json';	//Default location is one directory back
var newConfigFile = '/../config-original/linORIGINALconfig.json';	//This is for a new install generally - it will auto-create from this file
						//if the config doesn't yet exist
var addonsConfigFile = __dirname + '/../addons/config.json';
var htmlHeaderFile = __dirname + '/../public/components/header.html';
var htmlHeaderCode = "";				//This is loaded from disk on startup
var noFurtherFiles = "none";			//This gets piped out if there are no further files in directory
var jsonpCallback = "callback";			//The term used in the URL variable if calling using jsonp
var pairingURL = "https://medimage-pair.atomjump.com/med-genid.php";  //Redirects to an https connection. 
var listenPort = 5566;
var remoteReadTimer = null;
var globalId = "";
var httpsFlag = false;				//whether we are serving up https (= true) or http (= false)
var serverOptions = {};				//default https server options (see nodejs https module)
var bytesTransferred = 0;
var noWin = false;					//By default we are on Windows
var maxUploadSize = 10485760;		//In bytes, max allowed = 10MB
var readingRemoteServer = false;		//We have started reading the remote server
var allowPhotosLeaving = false;			//An option to allow/prevent photos from leaving the server
var allowGettingRemotePhotos = false;	//An option to allow reading a proxy server - usually the client (often Windows) will need this
										//set to true
var changeReadUrl = "";					//If we've changed the readingUrl, we must change the existing reading loop
var flapSimulation = false;			//Simulate service flapping from e.g. a faulty load balancer. Usually 'false' unless testing
var flapState = false;
var webProxy = null;				//For download requests from the internet, use a local proxy server at this URL
									//See: http://stackoverflow.com/questions/23585371/proxy-authentication-in-node-js-with-module-request

var allowedTypes = [ { "extension": ".jpg", "mime": "image/jpeg" },
      			     { "extension": ".pdf", "mime": "application/pdf" },
      				 { "extension": ".mp4", "mime": "video/mp4" },
      				 { "extension": ".mp3", "mime": "audio/mpeg" },
      				 { "extension": ".m4v", "mime": "video/mp4" },
      				 { "extension": ".m4a", "mime": "audio/m4a" },
      				 { "extension": ".csv", "mime": "text/csv" },
      				 { "extension": ".json", "mime": "application/json" }  ];
      				 
var allowedChars = "a-zA-z0-9#._-";			//Allowed characters in filename - default


var addons = [];					//Addon included modules.
global.globalConfig = null;			//This is a global current version of the config file, available to add-ons

//Handle a process sigint to quit smoothly
process.on('SIGINT', function() {
   console.log("Requesting a shutdown.");
   setTimeout(function() {
    // 100ms later the process kill it self to allow a restart
    console.log("Clean exit.");
    process.exit(0);
  }, 100);
});



process.on('uncaughtException', function(err) {
   console.log(err);
   console.log("Shutting down gracefully..");
   setTimeout(function() {
    // 2000ms later the process kill it self to allow a restart. E.g. if there is already another
    //server on the same port, and we are being run on pm2, it will wait a couple of seconds
    //before restarting - preventing it killing our CPU.
    console.log("Clean exit.");
    process.exit(0);
  }, 2000);
});




//Check any command-line options
if((process.argv[2]) && (process.argv[2] == '-verbose')){
	verbose = true;
}

if(process.env.npm_package_config_configFile) {
	//This is an npm environment var set for the location of the configFile
	configFile = process.env.npm_package_config_configFile;
	console.log("Using config file:" + configFile);

}


function pushIfNew(arry, str) {
  //Push a string to an array if it is new
  console.log("Attempting to add to array:" + str);
  for (var i = 0; i < arry.length; i++) {
    if (arry[i] === str) { // modify whatever property you need
      return;
    }
  }
  console.log("Pushing string");
  arry.push(str);
  return arry;
}


function serverParentDir() {
	//Get the current parent directory. E.g from C:\snapvolt\bin it will be relative ..\..\ = 'C:'
	var curdir = normalizeInclWinNetworks(__dirname + "/..");
	return curdir;
}

function ensurePhotoReadableWindows(fullPath, cb) {
	//Optional cb(err) passed back
	//Check platform is windows
	var platform = process.platform;
	if(verbose == true) console.log(process.platform);
	var isWin = /^win/.test(platform);
	if(verbose == true) console.log("IsWin=" + isWin);
	if(isWin) {
		//See: http://serverfault.com/questions/335625/icacls-granting-access-to-all-users-on-windows-7
		//Grant all users access, rather than just admin
		var run = 'icacls ' + fullPath + ' /t /grant Everyone:(OI)(CI)F';
		if(verbose == true) console.log("Running:" + run);
		exec(run, function(error, stdout, stderr){
			console.log(stdout);
			if(cb) {
			    if(error) {
				    cb(error);
				} else {
				    cb(null);
				}
			}
		});
	} else {
	    if(cb) {
	     cb(null);
	    }

	}
}


function shredWrapper(fullPath, theFile) {
	var platform = process.platform;
	if(verbose == true) console.log(process.platform);
	var isWin = /^win/.test(platform);
	if(verbose == true) console.log("IsWin=" + isWin);
	if(isWin) {
	
		var tempFile = fs.openSync(fullPath, 'r');
		fs.closeSync(tempFile);
	
		fs.unlinkSync(fullPath);
		console.log("Sent on and deleted " + theFile);

	} else {
		//Do a true linux shred
		shredfile.shred(fullPath, function(err, file) {
					if(err) {
						console.log(err);
						return;
					}
					console.log("Sent on and shredded " + theFile);
		});
	}

}


function ensureDirectoryWritableWindows(fullPath, cb) {
	//Optional cb(err) passed back
	//Check platform is windows
	var platform = process.platform;
	if(verbose == true) console.log(process.platform);
	var isWin = /^win/.test(platform);
	if(verbose == true) console.log("IsWin=" + isWin);
	if(isWin) {
		//See: http://serverfault.com/questions/335625/icacls-granting-access-to-all-users-on-windows-7
		//Grant all users access, rather than just admin
		var run = 'icacls ' + fullPath + ' /grant Everyone:(OI)(CI)F';
		if(verbose == true) console.log("Running:" + run);
		exec(run, function(error, stdout, stderr){
			console.log(stdout);
			if(cb) {
			    if(error) {
				    cb(error);
			    } else {
			        cb(null);
			    }
			}
		});
	} else {

	    cb(null);
	}
}


function readHTMLHeader(cb) {
	//Read the HTML standard header for pages. Returns the HTML code to the cb function, which includes the menu.
	//This is retained in memory as it is frequently accessed.
	
	fs.readFile(htmlHeaderFile, function read(err, data) {
		if (err) {
			
			cb("Sorry, cannot read the header file " + htmlHeaderFile, null);
			return;
		} else {
			htmlHeaderCode = data;		//Set the global
			cb(null, data);		
		}
	});

}


function checkConfigCurrent(setVals, cb) {
	//Reads and updates config to get any new hard-drives added to the system, or a GUID added
	//setProxy is optional, otherwise set it to null
	//Returns cb(err) where err = null, or a string with the error


	//Write to a json file with the current drive.  This can be removed later manually by user, or added to
	fs.readFile(configFile, function read(err, data) {
		if (err) {

			//Copy newconfig.json into config.json - it is likely a file that doesn't yet exist
			//Check file exists
			fs.stat(configFile, function(ferr, stat) {
				    if(ferr == null) {
				    	//File exists, perhaps a file permissions issue.
			        	cb("Sorry, cannot read the config file! Please check your file permissions. " + ferr);
				    } else if(ferr.code == 'ENOENT') {
				        // file does not exist. Copy across a new version of newconfig.json to config.json
				        // and re-run



				        fsExtra.copy(__dirname + newConfigFile, configFile, function (err) {
					  if (err) {
					  	return console.error(err)
					  } else {
					  	//Success - try reading again



					  	checkConfigCurrent(setVals, cb);
					  	return;
					  }
					}) // copies file
				    } else {
				    	//Some other error. Perhaps a permissions problem
					cb("Sorry, cannot read the config file! Please check your file permissions. " + ferr);
				    }
			});


		} else {
			if(data) {
				try {
					var content = JSON.parse(data);
				} catch(e) {
					//There was an error parsing the data. Use the existing global var if it exists.
					if(global.globalConfig) {
						content = global.globalConfig;
					} else {
						cb("Sorry, the config file is blank.");
						return;
					}
				}
			} else {
				if(global.globalConfig) {
					content = global.globalConfig;
				} else {
					cb("Sorry, the config file is blank.");
					return;
				}
			}

			if(!content.globalId) {
				//Only need to create the server's ID once. And make sure it is not the same as the developer's ID
				//Old style:content.globalId = uuid.v4();
				//Now we assume a blank guid to begin with.
		 	}


			 if(setVals) {
			 	if(typeof(setVals) !== 'object') {
			 		//It is a single readProxy value
			 		content.readProxy = setVals;
			 	} else {
				 	if(setVals.setReadProxy) {
				    	content.readProxy = setVals.setReadProxy;
				 	}
				 	if(setVals.setStyle) {
				 		content.style = setVals.setStyle;				 	
				 	}
				 	if(setVals.setCountryCode) {
				 		content.countryCode = setVals.setCountryCode;				 	
				 	}
				 	if(setVals.setProxy) {
				 		content.proxy = setVals.setProxy;
				 	}
				}
			 }

			 if((globalId)&&(validateGlobalId(globalId) !== false)) {
			   content.globalId = globalId;
			 }

			 if(content.globalId) {
			    globalId = content.globalId;
			 }

			 if(content.listenPort) {
			   listenPort = content.listenPort;
			 }
			 
			 if(content.allowedTypes) {
			 	allowedTypes = content.allowedTypes;
			 }

			 if(content.httpsKey) {
			 	//httpsKey should point to the key .pem file
			 	httpsFlag = true;
			 	if(!serverOptions.key) {
			 		serverOptions.key = fs.readFileSync(content.httpsKey);
			 		console.log("https key loaded");
			 	}
			 }

			 if(content.httpsCert) {
			 	//httpsCert should point to the cert .pem file
			 	httpsFlag = true;
			 	if(!serverOptions.cert) {
			 		serverOptions.cert = fs.readFileSync(content.httpsCert);
			 		console.log("https cert loaded");
			 	}

			 }
			 
			 if(content.webProxy) {
			 	//There is a web proxy server used for download requests from the web.
			 	//Format: "http://" + user + ":" + password + "@" + host + ":" + port
			 	//      or "http://" + host + ":" + port
			    webProxy = content.webProxy;
			 
			 }

			 //An option to allow/prevent photos from leaving the server (local installs i.e. non 'proxy' Windows clients
			 //should set this to false for security of the photos).
			 if(content.allowPhotosLeaving) {
			   allowPhotosLeaving = content.allowPhotosLeaving;
			 }

			 //An option to allow reading a proxy server - usually the client (often Windows) will need this
			 //set to true, but internet based servers should have this to false, so that it cannot eg. read itself.
			 if(content.allowGettingRemotePhotos) {
			   allowGettingRemotePhotos = content.allowGettingRemotePhotos;
			 }
			 
			 //An option to only allow certain characters
			 if(content.allowedChars) {
			 	allowedChars = content.allowedChars;
			 }


			 if(bytesTransferred != 0) {
			 	//Keep this up-to-date as we download
			 	content.transfer = bytesTransferred;
			 } else {
			 	if(content.transfer) {
			 		//Just starting server = get bytes from transfer
			 		bytesTransferred = content.transfer;
			 	}

			 }


			if(content.onStartBackupDriveDetect == true) {
				//Get the current drives - if we want to auto-detect them when they get inserted
				drivelist.list(function(error, disks) {
					if (error) {
						console.log("Warning: couldn't get the current drives for BackupDriveDetect. Error:" + error);
				
					} else {

						for(var cnt=0; cnt< disks.length; cnt++) {
							//On each drive, create a backup standard directory for photos
							if(verbose == true) console.log("Drive detected:" + JSON.stringify(disks[cnt]));
							var drive = disks[cnt].mountpoint;

							if(drive) {

								if(serverParentDir().indexOf(drive) < 0) {
									//Drive is not included in this server parent dir, therefore talking about a different drive

									//Create the dir
									if (!fs.existsSync(normalizeInclWinNetworks(drive + outdirDefaultParent))){
										fs.mkdirSync(normalizeInclWinNetworks(drive + outdirDefaultParent));
									}

									if (!fs.existsSync(normalizeInclWinNetworks(drive + outdirDefaultParent + outdirPhotos))){
										fs.mkdirSync(normalizeInclWinNetworks(drive + outdirDefaultParent + outdirPhotos));
									}

									//Append to the file's array if user has configured it as such
									if(content.onStartBackupDriveDetect == true) {
										content.backupTo = pushIfNew(content.backupTo, drive + outdirDefaultParent + outdirPhotos);
									}
								}
							}
						}
						
						try {
							var newContent = JSON.stringify(content, null, 6);
						}
						catch(err) {
							cb("Error: the config file cannot be written: " + err.message);
							return;
						}
							
						if(newContent) {
							//Set the global copy in RAM for add-ons to use
							globalConfig = content;
							
							 //Write the config file nicely formatted again, after we've added the new backup drives
							fs.writeFile(configFile, newContent, function(err) {
								

								if(verbose == true) console.log("The config file was saved!");

								//Now start any ping to read from a remote server
								if((content.readProxy) && (content.readProxy != "")) {
									startReadRemoteServer(content.readProxy);
								}
								
								if(err) {
									if(verbose == true) console.log("Warning: The config file was not saved! Error: " + err);
									cb(err);
								} else {
									cb(null);
								}
							});
						} else {
							//This is a blank config file. Leave as is.
							cb("Error: was about to save a blank config.");
						}
						
						
					}			

				 });
			 } else {
				
				try {
					var newContent = JSON.stringify(content, null, 6);
				} 
				catch(err) {
					cb("Error: the config file cannot be written: " + err.message);
					return;
				}
						
				if(newContent) {
					//Set the global copy in RAM for add-ons to use 
					globalConfig = content;
					 
				 	 //Write the config file nicely formatted again
					fs.writeFile(configFile, newContent, function(err) {

						if(verbose == true) console.log("The config file was saved!");

						//Now start any ping to read from a remote server
						if((content.readProxy) && (content.readProxy != "")) {
							startReadRemoteServer(content.readProxy);
						}
						
						if(err) {
							if(verbose == true) console.log("Warning: The config file was not saved! Error: " + err);
							cb(err);
						} else {
							cb(null);
						}
					});
				} else {
					//This is a blank config file. Leave as is.
					cb("Error: was about to save a blank config.");
				
				}
				
			 			 
			 
			 }
			 
			


		};
	});

}


function fileWalk(startDir, cb)
{
   //Read and return the first file in dir, and the count of which file it is. Only the cnt = 0 is used
   var items = [];
   if(verbose == true) console.log("Searching:" + startDir);

   if (fsExtra.existsSync(normalizeInclWinNetworks(startDir))){
       try {
           var walk = klaw(startDir);

	        walk.on('data', function (item) {
	                if(verbose == true) console.log("Found:" + item.path);
			        items.push(item.path);
		          })
		          .on('end', function () {
			        for(var cnt = 0; cnt< items.length; cnt++) {
				        
				        //Go through allowed file types array 
				        for(var type = 0; type < allowedTypes.length; type++) {
				         
							 if(items[cnt].indexOf(allowedTypes[type].extension) >= 0) {
								cb(items[cnt], allowedTypes[type].mime);
								return;
							 }
						}
			        }
			        
			        cb(null);
	          });
	   } catch(err) {
	    console.log("Error reading:" + err);
	    cb(null);
	   }
	} else {
	    cb(null);

	}


}

//Courtesy http://stackoverflow.com/questions/15900485/correct-way-to-convert-size-in-bytes-to-kb-mb-gb-in-javascript
function formatBytes(bytes,decimals) {

   if(verbose == true) console.log("Bytes: " + bytes);
   if(bytes == 0) return 'None';
   var k = 1000; // or 1024 for binary
   var dm = decimals + 1 || 3;
   var sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
   var i = Math.floor(Math.log(bytes) / Math.log(k));
   return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}


function download(uri, callback){



	//Get a header of file first - see if there is any content (this will be pinged once every 10 seconds or so)
	request.head({url: uri, pool: separateReqPool, forever: true, proxy: webProxy }, function(err, res, body){
		if(err) {
			console.log("Error requesting from proxy:" + err);
			callback(err);
		} else { //No error
		    	if(verbose == true) {
				console.log(JSON.stringify(res.headers));
			    	console.log('content-type:', res.headers['content-type']);
			    	console.log('content-length:', res.headers['content-length']);
			    	console.log('file-name:', res.headers['file-name']);
		    	}
		    	//Check if there is a filename
		        if(res.headers['file-name']) {

				//Yes there was a new photo file to download fully.
				var dirFile = res.headers['file-name'];
				dirFile = trimChar(dirFile.replace(globalId + '/', '')); //remove our id and any slashes around it


				var createFile = normalizeInclWinNetworks(trailSlash(serverParentDir()) + trailSlash(outdirPhotos) + dirFile);


				if(verbose == true) console.log("Creating file:" + createFile);
				var dirCreate = path.dirname(createFile);
				if(verbose == true) console.log("Creating dir:" + dirCreate);

				//Make sure the directory exists
				fsExtra.ensureDir(dirCreate, function(err) {
					if(err) {
						console.log("Warning: Could not create directory for: " + dirCreate);
						callback("Warning: Could not create directory for: " + dirCreate);
					} else {
						if(verbose == true) console.log("Created dir:" + dirCreate);
						ensureDirectoryWritableWindows(dirCreate, function(err) {

							if(err) {
								//Could not get a true directory
								console.log("Error processing dir:" + err);
								callback("Error processing dir:" + err);
							} else {
								//Got a good directory
								if(verbose == true) console.log("Directory processed");
								if(verbose == true) console.log("About to create local file " + createFile + " from uri:" + uri);


								var stream = request({url: uri, pool: separateReqPool, forever: true });
								var alreadyClosed = false;
								stream.pipe(fs.createWriteStream(createFile)
												.on('error', function(err) {
													console.log("Error writing to file");
													callback(err);
												})
											)
								.on('close', function() {

									console.log("Downloaded successfully!" + createFile);
									if(alreadyClosed == false) {
										alreadyClosed = true;

										//Update the data transferred successfully
										if(uri.indexOf("atomjump.com") >= 0) {
											try {
											  	//File exists
											  var stats = fs.statSync(createFile);
											  var fileSizeInBytes = stats["size"];
											  bytesTransferred += fileSizeInBytes;

											  //Save the bytes transferred to atomjump.com for progress
											  checkConfigCurrent(null, function() {

											  })
											}
											catch(err) {
												console.log('Warning: file ' + createFile + ' did not exist.');
											}											
										}

										if(createFile.indexOf(".jpg") >= 0) {
											var event = "photoWritten";
										} else {
											var event = "fileWritten";
										}
										
										addOns(event, function(err, normalBackup) {
											if(err) {
												console.log("Error writing file:" + err);
											} else {
												if(verbose == true) console.log("Add-on completed running");
									
											}
									
											if(normalBackup == true) {
												//Now we have finished processing the file via the addons,
												//backup the standard files if 'normal' is the case
												backupFile(createFile, "", dirFile, { });
											}
										}, createFile);
											

										
										
										callback(null);		//Carry on with normal operations, with the addons working in the background
									} else {
										console.log("2nd close event");
									}
								});


							} //End of got a good directory



						}); //end of ensureDirectoryWritableWindows

					}
				}); //end of ensuredir exists


			} else {
				//No filename in returned ping here
				if(verbose == true) console.log("No file to download");
				callback(null);
			}

		} //end of no error from ping of proxy
	}); //end of request head


}



function startReadRemoteServer(url)
{
	if(allowGettingRemotePhotos == false) {
		console.log("Error: Sorry, this server is not configured to read a remote server.");
		return;
	}

	if(readingRemoteServer == false) {
		readingRemoteServer = true;
		readRemoteServer(url);
	} else {
		//Double reading - switch over the readRemoteServer already existing to the new url
		changeReadUrl = url;
			
	}
}

function readRemoteServer(url)
{
	//Every 5 seconds, read the remote server in the config file, and download images to our server.
	//But pause while each request is coming in until fully downloaded.

		//If it already exists we need to be able to change this ping
		if(changeReadUrl != "") {
			url = changeReadUrl;
			changeReadUrl = "";
		}

		var _url = url;
		

		
		setTimeout(function() {
			process.stdout.write("'");     //Display movement to show download pinging
			var thisComplete = false;		//This is a flag for this request only.
			download(url, function(){
				  if(verbose == true) console.log("Ping status: " + thisComplete);
				  if(thisComplete == false) {
				  		//It is possible we have been run by the timeout below, so don't repeat (or we would get faster and faster)
				  	 	thisComplete = true;
				  		readRemoteServer(_url);
				  }
			});
			
			//Now do a double check there has been no problem during the download. Have a timeout after 5 minutes to restart the ping process.
			setTimeout(function() {
				if(verbose == true) console.log("Ping status after 1 minutes time: " + thisComplete);
				if(thisComplete == false) {
					//OK restart the ping still.
					thisComplete = true;
					readRemoteServer(_url);				
				}
			}, 60000);   //Should be 60000 = 1 minute

		}, 5000);


}

function trailSlash(str)
{
	if(str.slice(-1) == "/") {
		return str;
	} else {
		var retStr = str + "/";
		return retStr;
	}

}


function normalizeInclWinNetworks(path)
{
	//Tests to see if the path is a Windows network path first, if so, handle this case slightly differently
	//to a normal upath.normalization.
	//Run this before 
	if((path[0] == "\\")&&(path[1] == "\\")) {
		
		var retval = "\/" + upath.normalize(path);		//Prepend the first slash
	} else {
		if((path[0] == "\/")&&(path[1] == "\/")) {
			//In unix style syntax, but still a windows style network path
			var retval = "\/" + upath.normalize(path);		//Prepend the first slash
		} else {
			var retval = upath.normalize(path);
		}
	}
	
	if((retval[1]) && (retval[1] == ':')) {
		//Very Likely a Windows path. Capitalise first letter
		retval = retval.charAt(0).toUpperCase() + retval.slice(1);
	}
	
	return retval;

}



function backupFile(thisPath, outhashdir, finalFileName, opts, cb)
{
	// thisPath:  full path of the file to be backed up from the root file system
	// outhashdir:   the directory path of the file relative to the root photos dir /photos. But if blank, 
	//					this is included in the finalFileName below.
	// finalFileName:  the photo or other file name itself e.g. photo-01-09-17-12-54-56.jpg
	// opts: 
	//    {first: true} 				Process the first on the list (defaults to true)
	//    {secondary: true}  			Process the remainder paths on the list (defaults to true)
	//    {keepOriginal: false}		    Keep the original file (defaults to "useMasterConfig").
	//											which takes this value from the config file
	//Will call cb once all are completed, with (err, null) if there was an error, or (null, newPath) if none
	// where newPath is the last output file path (a single file only - most useful when opts.first is true)
	
	var lastNewPath = thisPath;
	
	if(!opts) {
		opts = {};
	}
	if(!opts.first) {
		opts.first = true;
	}
	if(!opts.secondary) {
		opts.secondary = true;
	}
	if(!opts.keepOriginal) {
		opts.keepOriginal = "useMasterConfig";
	}
	if(!cb) {
		cb = function() {};
	}
	
	
	
	
	//Read in the config file
	fs.readFile(configFile, function read(err, data) {
		if (err) {
			console.log("Warning: Error reading config file for backup options: " + err);
			cb(err, null);
		} else {
			if(data) {
				try {
					var content = JSON.parse(data);
				} catch(e) {
					//There was an error parsing the data. Use the existing global var.
					var content = global.globalConfig;
				}
			} else {
				//There was an error reading the data. Use the existing global var.
				var content = global.globalConfig;
			}


			if(content.backupTo && content.backupTo[0] && content.backupTo[0] != "") {
			
				
			
				//Loop through all the backup directories
				async.eachOf(content.backupTo,
					// 2nd param is the function that each item is passed to
					function(runBlock, cnt, callback){
				
						
						if((cnt == 0) && (opts.first == false)) {
							//Early exist on this one
							callback(null);
							return;
						}
						
						if((cnt > 0)&& (opts.secondary == false)) {
							//Early exist on this one
							callback(null);
							return;
						
						}
						
						
						if(outhashdir) {
							var replaceCoreFolder = normalizeInclWinNetworks(trailSlash(content.backupTo[cnt]));		//Used in Windows shared drive absolute path case
							var targetDir = normalizeInclWinNetworks(trailSlash(content.backupTo[cnt]) + trailSlash(outhashdir));
						} else {
							var targetDir = normalizeInclWinNetworks(trailSlash(content.backupTo[cnt]));
							
						}
						
						lastNewPath = targetDir + finalFileName;	//Last path recorded for return journey
						lastNewPath = normalizeInclWinNetworks(lastNewPath.trim());
						
						
						if(verbose == true) console.log("finalFileName = " + finalFileName);
						if((finalFileName[1]) && (finalFileName[1] == ':')) {
							//Very likely a Windows absolute path case
							
							var target = finalFileName;
							
							targetDir = path.dirname(target);
							
							if(outhashdir) {
								//Need to the hash dir added here
								targetDir = str.replace(replaceCoreFolder, targetDir);
							}
						} else {
							//A normal case
							var target = targetDir + finalFileName;
						}
						target = normalizeInclWinNetworks(target.trim());
						
						
						if(verbose == true) console.log("targetDir = " + targetDir);
						if(verbose == true) console.log("target = " + target);
						
						//lastNewPath = target;		//Record for the return journey
						thisPath = normalizeInclWinNetworks(thisPath.trim());		//OLD: Remove double slashes. Normalize will handle that
						
						
						if(verbose == true) console.log("Backing up " + thisPath + " to:" + target);

						fsExtra.ensureDir(targetDir, function(err) {
							if(err) {
								console.log("Warning: Could not create directory for backup: " + targetDir + " Err:" + err);
								callback(err);
							} else {
								try {
									
									if(thisPath !== target) {
										console.log("Copying " + thisPath + " to " + target);
										fsExtra.copy(thisPath, target, function(err) {
										  if (err) {
										  	 console.error('Warning: there was a problem copying '+ thisPath + ' to ' + target + ' Error:' + JSON.stringify(err));
											 callback(err, null);
										  } else {
										 
											 ensurePhotoReadableWindows(target);
											
											 //And finally, remove the old file, if the option is set
											 if(opts.keepOriginal == "useMasterConfig") {
											 
											 	//Determine whether to keep the original photo file based off the global setting
												opts.keepOriginal = true;
												if( typeof content.keepMaster === 'undefined') {
																		//Not considered
												 } else {
														if(content.keepMaster == false) {
															 opts.keepOriginal = false;
														}
												 }
											 }
											 
											 if(opts.keepOriginal == false) {
											 
												fsExtra.remove(thisPath, function(err) {
												  if (err) {
													console.error('Warning: there was a problem removing: ' + err.message)
													callback(err, null);
												  } else {
													console.log('Removed the file: ' + thisPath);
													callback(null);
												  }
												});
													
											 } else {
											 	callback(null);
											 }
										  }

									  
										}) // copies file
									} else {
										//Same file
										callback(null);
									}

									
									
								} catch (err) {
									console.error('Warning: there was a problem backing up: ' + err.message);
									callback(err, null);
								}
							}
						});
					
					},	//End of async eachOf single item
					  function(err){
						// All tasks are done now
						if(err) {
						   console.log('ERR:' + err);
						   cb(err, null);
						 } else {
						   if(verbose == true) console.log('Completed all backups!');					   
						   cb(null, lastNewPath);
						 }
					   }
				); //End of async eachOf all items
				
				
				
			} else { //End of check there is a backup
			
				cb(null, lastNewPath);		//Ouput the same file.
			}
			
		} //End of no error on reading config

	});
}


function getPlatform() {
	var platform = process.platform;
	if(verbose == true) console.log(process.platform);
	var isWin = /^win/.test(platform);
	if(verbose == true) console.log("IsWin=" + isWin);
	if(isWin) {
		if(process.arch == 'x64') {
			return "win64";
		} else {
			return "win32";
		}
	} else {
		if(platform == "darwin") {
			return "mac";
		} else {
			return "unix";
		}
	
	}
}







function myExec(cmdLine, priority, cb) {
	
	//Does a system exec command, or runs the command as a process with spawn, depending on priority.
	//In the spawn case, we need a single command, and discrete arguments in the string, which are divided by spaces.
	//Priority can be 'high', 'medium', 'low', 'glacial'. 
	//  - 'high' in real-time response situations - nodejs included into RAM directly. The first word should be 'node',
	//      2nd word is the path to the .js file, and then the following params are written into argv.
	//  - 'medium' - uses spawn, rather than exec, so a whole shell is not opened, without that additional overhead.
	//  - 'low' - uses exec, rather than spawn, so a whole shell is opened, but any system command can be used, including pipes, although be careful of the cross-platform limtations.
	//  - 'glacial' - will use the spawn command (no shell), but will insert our own shell, based on platform, with a background
	//                 running option set. I.e. in Windows, this is 'cmd.exe /low /s /c', and in unix this is 'nice'
	//It will call cb with (err, stdout, stderr)
	
	
	switch(priority) {
		case 'high':	
			cmds = cmdLine.split(" ");
			var argv = [];
			var globalId = {};
			var scriptPath = "";
			if(cmds[0]) {
				//Should be 'node'
			}
			
			if(cmds[1]) {
				scriptPath = cmds[1];			
			}
			
			if(cmds[2]) {
				//Params
				cmds.splice(0, 2);
				argv = cmds;
			} else {
				//No arguments
				argv = [];
			}
			
			if(verbose == true) console.log("Global id:" + globalId + " scriptPath:" + scriptPath + " argv:" + JSON.stringify(argv));
			
			var lib = require(scriptPath);
			
			var mycb = cb;
			lib.medImage(argv, function(err, retVal) {
				if(err) {
					console.log("Error:" + err);
					mycb(err, "", "");
				} else {
					if(retVal) {
						if(!retVal.stdout) retVal.stdout = "";		//Ensure not undefined
						if(!retVal.stderr) retVal.stderr = "";
						mycb(null, retVal.stdout, retVal.stderr);
					} else {
						mycb(null,"","");
		
					}
				} 
			
			});
								
 					
			//Wait till finished - the add-on will callback via cb();
			
		
		break;
		
		
		case 'medium':
			//Break up the cmdLine into 'command', args[]
			cmds = cmdLine.split(" ");
			var args = [];
			var command = "";
			if(cmds[0]) {
				command = cmds[0];
				if(command == "node") {
					command = process.execPath;		//Get the system node path
				}
			}
			
			if(cmds[1]) {
				cmds.splice(0, 1);
				var args = cmds;
			}
					
			var outputStdOut = "";
			var outputStdError = "";
			
			var running = spawn(command, args);
			

			running.stdout.on('data', (data) => {
			    if(verbose == true) console.log(data.toString());
			    outputStdOut += data.toString();
			  
			});

			running.stderr.on('data', (data) => {
				if(verbose == true) console.log(data.toString());
				outputStdError += data.toString();
			});

			running.on('close', (code, signal) => {
			  if(verbose == true) console.log(`Child process exited with code ${code} ` + outputStdOut);
			  if(signal) {
			  	  cb(code, outputStdOut, outputStdError);
			  } else {
			  	  cb(null, outputStdOut, outputStdError);
			  }
			});
			
		break;
		
		case 'low':
			exec(cmdLine, { maxBuffer: 2000 * 1024 }, cb);		
		break;
		
		case 'glacial':
			//Get ready
			
			var outputStdOut = "";
			var outputStdError = "";

			 
			cmds = cmdLine.split(" ");
			var args = [];
			var command = "";
			if(cmds[0]) {
				args = cmds;
			}
			
			//Now, based off platform, decide to run it slowly
			var platform = getPlatform();
			if((platform == "win32")||(platform == "win64")) {
				command = "cmd.exe"
				args.unshift('/low','/s','/c');
			
			} else {
				//Unix/mac
				command = "nice";	
				args.unshift('-10');		//This is a priority of 10, which is pretty low.				
			}
			
			var running = spawn(command, args);

			running.stdout.on('data', (data) => {
				if(verbose == true) console.log(data.toString());
			    outputStdOut += data.toString();
			  
			});

			running.stderr.on('data', (data) => {
				if(verbose == true) console.log(data.toString());
				outputStdError += data.toString();
			});

			running.on('close', (code, signal) => {
			  if(signal) {
			  	  cb(code, outputStdOut, outputStdError);
			  } else {
			  	  cb(null, outputStdOut, outputStdError);
			  }
			});			
		
		break;
		
		default:
		
			//Do a full shell script, i.e. the same as 'low'
			exec(cmdLine, { maxBuffer: 2000 * 1024 }, cb);	
		
		break;
	
	}
	
	return;
}


function validateGlobalId(globalId) {
	//Returns the global id if the input globalId sting is valid, or 'false' if not
	//Format is 18 characters, ASCII. If any unusual punctuation characters then it is not correct.
	//We will give some leeway over the number of characters in case the pairing server has any changes, but it must 
	//have more than 16 characters.
	
	if(globalId.length > 16) {
		var format = /^[a-zA-Z0-9]+$/;
		if(format.test(globalId) === true) {
			return globalId;
		} else {
			return false;
		}
		
	}
	return false;

}


function runCommandPhotoWritten(runBlock, backupAtEnd, param1, param2, param3, cb) {

	var cmdLine = runBlock.runProcess;
	cmdLine = cmdLine.replace(/parentdir/g, serverParentDir());
	
	cmdLine = cmdLine.replace(/param1/g, param1);
	cmdLine = cmdLine.replace(/param2/g, param2);
	cmdLine = cmdLine.replace(/param3/g, param3);
	console.log("Running addon line: " + cmdLine);

	

	myExec(cmdLine, runBlock.priority, function(err, stdout, stderr) {
	  if (err) {
		// node couldn't execute the command
		console.log("There was a problem running the addon. Error:" + err + "\n\nStdout:" + stdout + "\n\nStderr:" + stderr);
		cb(err);
		
	  } else {
  
  		  if((stdout)||(stderr)) {
		  	console.log("Stdout from command:" + stdout + "\n\nStderr" + stderr); 
		  }		
  
		  //Potentially get any files that are new and need to be backed-up
		   //to the config-specified folders. This should be before echoed to stdout as 'backupFiles:' near the end of 
		   //the script output. 
		   backupFilesStr = "backupFiles:";
		   var backupFiles = "";
		   var backStart = stdout.lastIndexOf(backupFilesStr);
		   
		   
		   //Special case of the original file is renamed
		   backupFileRenamedStr = "backupFileRenamed:";	
		   if(stdout.lastIndexOf(backupFileRenamedStr) > -1) {
				backStart = stdout.lastIndexOf(backupFileRenamedStr);
				normalBackup = false;
		   }
   
		   returnparams = "returnParams:";
		   var returnStart = stdout.lastIndexOf(returnparams);
			   
   
		   //Backups will take place asyncronously, in the background	
		   if(backStart > -1) {
				
				//Yes string exists
				if(returnStart > -1) {
					//Go to the start of the returnParams string
					var backLen = returnStart - backStart;
					backupFiles = stdout.substr(backStart, backLen);
				} else {
					//Go to the end of the file otherwise
					backupFiles = stdout.substr(backStart);
	
				}
		
	
				console.log("Backing up requested of " + backupFiles);
				backupFiles = backupFiles.replace(backupFilesStr,"");		//remove locator
				backupFiles = backupFiles.replace(backupFileRenamedStr,"");		//remove locator
				backupFiles = backupFiles.trim();		//remove newlines at the end
				if(verbose == true) console.log("Backing up string in server:" + backupFiles);
				var backupArray = backupFiles.split(";");	//Should be semi-colon split
				if(verbose == true) console.log("Backing up array:" + JSON.stringify(backupArray));
		
				//Now loop through and back-up each of these files.
				for(var cnt = 0; cnt<backupArray.length; cnt++) {	
		
					// thisPath:  full path of the file to be backed up from the root file system
					// outhashdir:   the directory path of the file relative to the root photos dir /photos. But if blank, 
					//					this is included in the finalFileName below.
					// finalFileName:  the photo or other file name itself e.g. photo-01-09-17-12-54-56.jpgvar thisPath = path.dirname(backupArray[cnt]);
					var photoParentDir = normalizeInclWinNetworks(serverParentDir() + outdirPhotos);
					if(verbose == true) console.log("Backing up requested files from script");
					if(verbose == true) console.log("photoParentDir=" + photoParentDir);
					var finalFileName = normalizeInclWinNetworks(backupArray[cnt]);
					finalFileName = finalFileName.replace(photoParentDir,"").trim();		//Remove the photo's directory from the filename
					if(verbose == true) console.log("finalFileName=" + finalFileName);
					var thisPath = normalizeInclWinNetworks(backupArray[cnt].trim());
					if(verbose == true) console.log("thisPath=" + thisPath);
					backupAtEnd.push({ "thisPath": thisPath,
										"finalFileName": finalFileName });
					
				}
			}
  
  
  
		  reloadConfig = "reloadConfig:true";	
		  if(stdout.lastIndexOf(reloadConfig) > -1) {
				checkConfigCurrent(null, function() {
					//This is run async - refresh the config in the background.
					
					//And reload the header
					readHTMLHeader(function(err) {
						if(err) {
							console.log(err);
						}
					});
					
				});
		   }
  

		  // the *entire* stdout and stderr (buffered)
		  if(verbose == true) console.log(`stdout: ${stdout}`);
		  if(verbose == true) console.log(`stderr: ${stderr}`);
		  
		  cb(null);
	  }

	});
}



//Handle 3rd party and our own add-ons
function addOns(eventType, cb, param1, param2, param3) 
{
	//Read in any add-ons that exist in the config?, or in the 'addons' folder.
	
	//Read in the config file
	fs.readFile(addonsConfigFile, function read(err, data) {
		if (err) {
			console.log("Warning: Error reading addons config file: " + err);
		} else {
			if(data) {
				try {
					var content = JSON.parse(data);
				} catch(e) {
					//There was an error parsing the data. Use the existing global var.
					var content = global.globalConfig;
				}
			} else {
				//There was an error reading the data. Use the existing global var.
				var content = global.globalConfig;
			}

			if(verbose == true) {
				console.log("Got content of addons config");			
			}
	
			switch(eventType)
			{
				case "photoWritten":
					//param1 is the full path of the new photo in the home directory (not the backed up copy)
					if(content.events.photoWritten) {
						
						var normalBackup = true;
						var evs = content.events.photoWritten;
						var backupAtEnd = [];
						
						
						console.log("PARAM1:" + param1);
						
						
						//Asyncronously call each item, but in sequential order. This means the process could
						//be doing something processor intensive without holding up the main server, but still allow
						//each add-on to potentially process sequentially. This could be useful for chaining image resizing,
						//image processing add-ons together in the correct order.
						async.eachOfSeries(evs,
							  // 2nd param is the function that each item is passed to
							  function(runBlock, cnt, callback){
						
						
						
								//for(var cnt = 0; cnt< evs.length; cnt++) {
								if(runBlock.active == true) {
									//Run the command off the system 
									
									//First check if we need to backup the file into the target before running with
									//the target version.
									if((runBlock.useTargetFolderFile)&&(runBlock.useTargetFolderFile == true)) {
										
										
										
										var cmdLine = runBlock.runProcess;
										cmdLine = cmdLine.replace(/parentdir/g, serverParentDir());
	
										cmdLine = cmdLine.replace(/param1/g, param1);
										cmdLine = cmdLine.replace(/param2/g, param2);
										cmdLine = cmdLine.replace(/param3/g, param3);
										
										var photoParentDir = normalizeInclWinNetworks(serverParentDir() + outdirPhotos);
										if(verbose == true) console.log("Backing up requested files from script");
										if(verbose == true) console.log("photoParentDir=" + photoParentDir);
										var finalFileName = normalizeInclWinNetworks(param1);
										finalFileName = finalFileName.replace(photoParentDir,"").trim();		//Remove the photo's directory from the filename
										if(verbose == true) console.log("finalFileName=" + finalFileName);
										var thisPath = normalizeInclWinNetworks(param1);
										if(verbose == true) console.log("thisPath=" + thisPath);
																			
										
										//Start with a backup of the file in param1, and replace that for the photoWritten command param1
										backupFile(thisPath, "", finalFileName, { }, function(err, newPath) {
										
											if(err) {
												callback(err, null);
											} else {
										
												runCommandPhotoWritten(runBlock, backupAtEnd, newPath, param2, param3, function(err) {
													if(err) {
														callback(err);
													} else {											
														//Note: we must call back here once the system command has finished. This allows us
														//to go on to the next command, sequentially, though each command is run async
														callback(null);
													}											
												});
											}
										
										});
									} else {
									
										//Do a normal processing of the content from within the transition folder (e.g. C:\MedImage\photos on Windows)
										runCommandPhotoWritten(runBlock, backupAtEnd, param1, param2, param3, function(err) {
											if(err) {
												callback(err);
											} else {											
												//Note: we must call back here once the system command has finished. This allows us
												//to go on to the next command, sequentially, though each command is run async
												callback(null);
											}
											
										});
									}
								} else {	//End of is active check
									//We must callback even if it is not active, to go to the next option
									 callback(null);
								}
						
						},	//End of async eachOf single item
							  function(err){
								// All tasks are done now
								if(err) {
								   console.log('ERR:' + err);
								 } else {
								   console.log('Completed all photoWritten events!');
								   
								   //Carry out the backups after all commands have finished
								   for(var cnt = 0; cnt < backupAtEnd.length; cnt++) {	
								   		backupFile(backupAtEnd[cnt].thisPath, "", backupAtEnd[cnt].finalFileName,  { });
								   }
								   
								   
								   
								   cb(null, normalBackup);
								 }
							   }
					  	); //End of async eachOf all items
					
					}
		
				break;
				
				
				case "fileWritten":
					//Only difference here is it is a generic file that has been written rather than a photo .jpg file
					//param1 is the full path of the new file in the home directory (not the backed up copy)
					if(content.events.fileWritten) {
						
						var normalBackup = true;
						var evs = content.events.fileWritten;
						var backupAtEnd = [];
						
						
						console.log("PARAM1:" + param1);
						
						
						//Asyncronously call each item, but in sequential order. This means the process could
						//be doing something processor intensive without holding up the main server, but still allow
						//each add-on to potentially process sequentially. This could be useful for chaining image resizing,
						//image processing add-ons together in the correct order.
						async.eachOfSeries(evs,
							  // 2nd param is the function that each item is passed to
							  function(runBlock, cnt, callback){
						
						
						
								//for(var cnt = 0; cnt< evs.length; cnt++) {
								if(runBlock.active == true) {
									//Run the command off the system 
									
									//First check if we need to backup the file into the target before running with
									//the target version.
									if((runBlock.useTargetFolderFile)&&(runBlock.useTargetFolderFile == true)) {
										
										
										
										var cmdLine = runBlock.runProcess;
										cmdLine = cmdLine.replace(/parentdir/g, serverParentDir());
	
										cmdLine = cmdLine.replace(/param1/g, param1);
										cmdLine = cmdLine.replace(/param2/g, param2);
										cmdLine = cmdLine.replace(/param3/g, param3);
										
										var photoParentDir = normalizeInclWinNetworks(serverParentDir() + outdirPhotos);
										if(verbose == true) console.log("Backing up requested files from script");
										if(verbose == true) console.log("photoParentDir=" + photoParentDir);
										var finalFileName = normalizeInclWinNetworks(param1);
										finalFileName = finalFileName.replace(photoParentDir,"").trim();		//Remove the photo's directory from the filename
										if(verbose == true) console.log("finalFileName=" + finalFileName);
										var thisPath = normalizeInclWinNetworks(param1);
										if(verbose == true) console.log("thisPath=" + thisPath);
																			
										
										//Start with a backup of the file in param1, and replace that for the photoWritten command param1
										backupFile(thisPath, "", finalFileName, { }, function(err, newPath) {
										
											if(err) {
												callback(err, null);
											} else {
										
												runCommandPhotoWritten(runBlock, backupAtEnd, newPath, param2, param3, function(err) {
													if(err) {
														callback(err);
													} else {											
														//Note: we must call back here once the system command has finished. This allows us
														//to go on to the next command, sequentially, though each command is run async
														callback(null);
													}											
												});
											}
										
										});
									} else {
									
										//Do a normal processing of the content from within the transition folder (e.g. C:\MedImage\photos on Windows)
										runCommandPhotoWritten(runBlock, backupAtEnd, param1, param2, param3, function(err) {
											if(err) {
												callback(err);
											} else {											
												//Note: we must call back here once the system command has finished. This allows us
												//to go on to the next command, sequentially, though each command is run async
												callback(null);
											}
											
										});
									}
								} else {	//End of is active check
									//We must callback even if it is not active, to go to the next option
									 callback(null);
								}
						
						},	//End of async eachOf single item
							  function(err){
								// All tasks are done now
								if(err) {
								   console.log('ERR:' + err);
								 } else {
								   console.log('Completed all fileWritten events!');
								   
								   //Carry out the backups after all commands have finished
								   for(var cnt = 0; cnt < backupAtEnd.length; cnt++) {	
								   		backupFile(backupAtEnd[cnt].thisPath, "", backupAtEnd[cnt].finalFileName,  { });
								   }
								   
								   
								   
								   cb(null, normalBackup);
								 }
							   }
					  	); //End of async eachOf all items
					
					}
		
				break;
				
				
				case "urlRequest":
					if(verbose == true) console.log("URL request of " + param1);
					
					if(content.events && content.events.urlRequest) {
							
							var evs = content.events.urlRequest;
							for(var cnt = 0; cnt< evs.length; cnt++) {
								
								//Check if script in param1 starts with the scriptURLName
								var scriptChk = evs[cnt].scriptURLName;
								if(verbose == true) console.log("Checking against:" + scriptChk);
								
								if(param1.substr(0,scriptChk.length) == scriptChk) {
									if(evs[cnt].active == true) {
										//Run the command off the system - passing in the URL query string directly as a single url encoded string 								
										var cmdLine = evs[cnt].runProcess;
										cmdLine = cmdLine.replace(/parentdir/g, serverParentDir());
										
										param1 = param1.replace("%23", "#");		//allow hashes to be sent in the url - reverse code them. TODO Would this affect e.g. %2345 ?
										param1 = param1.replace("%20", " ");		//allow spaces to be sent in the url - reverse code them. TODO Would this affect e.g. %2345 ?
										
										var queryString = encodeURIComponent(param1.replace(scriptChk + "?",""));
										
										
										cmdLine = cmdLine.replace(/param1/g, queryString);
										if(verbose == true) console.log("Running addon line: " + cmdLine);
								
										if(evs[cnt].waitForRequestFinish) {
											//Forward on to this page afterwards
										  	 var waitForIt = evs[cnt].waitForRequestFinish;
										} 
										
										//Pass through the priority
										myExec(cmdLine, evs[cnt].priority, function(err, stdout, stderr) {
										  if (err) {
											// node couldn't execute the command
											console.log("There was a problem running the addon. Error:" + err + "\n\nStdout:" + stdout + "\n\nStderr:" + stderr);
											return;
										  }

										  // the *entire* stdout and stderr (buffered)
										  if(stdout) {
										  	console.log(`stdout: ${stdout}`);
										  }
										  if(stderr) {
										  	console.log(`stderr: ${stderr}`);
										  }
										  
										
											if(waitForIt) {
											   //The script has run, now parse for the return parameters	
											   returnparams = "returnParams:";
											   var params = "";
											   if(verbose == true) console.log("Stdout:" + stdout);
											   var returnStart = stdout.lastIndexOf(returnparams);
											   
											   reloadConfig = "reloadConfig:true";	
											   if(stdout.lastIndexOf(reloadConfig) > -1) {
													checkConfigCurrent(null, function() {
														//This is run async - refresh the config in the background.
														
														//And reload the header
														readHTMLHeader(function(err) {
															if(err) {
																console.log(err);
															}
														});
														
													});
											   }
											   
											  
											   if(returnStart > -1) {
											   		//Yes return params exists
											   		params = stdout.substr(returnStart);
											   		params = params.replace(returnparams + "?","");		//remove questions
											   		params = params.replace(returnparams,"");		//remove the locator
											   		params = params.trim();		//remove newlines at the end
											   		if(verbose == true) console.log("Params returned=" + params);
											   }
											   
											   
											   //But also potentially get any files that are new and need to be backed-up
											   //to the config-specified folders. This should be before the returnParams
											   backupFilesStr = "backupFiles:";
											   var backupFiles = "";
											   var backStart = stdout.lastIndexOf(backupFilesStr);
											   
											   if(backStart > -1) {
											   		if(verbose == true) console.log("Backing up requested");
											   		
											   		//Yes string exists
											   		if(returnStart > -1) {
											   			//Go to the start of the returnParams string
											   			var backLen = returnStart - backStart;
											   			backupFiles = stdout.substr(backStart, backLen);
											   		} else {
											   			//Go to the end of the file otherwise
											   			backupFiles = stdout.substr(backStart);
											   		
											   		}
											   		backupFiles = backupFiles.replace(backupFilesStr,"");		//remove locator
											   		backupFiles = backupFiles.trim();		//remove newlines at the end
											   		if(verbose == true) console.log("Backing up string in server:" + backupFiles);
											   		var backupArray = backupFiles.split(";");	//Should be semi-colon split
											   		if(verbose == true) console.log("Backing up array:" + JSON.stringify(backupArray));
											   		
											   		//Now loop through and back-up each of these files.
											   		for(var cnt = 0; cnt<backupArray.length; cnt++) {	
											   		
										   				// thisPath:  full path of the file to be backed up from the root file system
														// outhashdir:   the directory path of the file relative to the root photos dir /photos. But if blank, 
														//					this is included in the finalFileName below.
														// finalFileName:  the photo or other file name itself e.g. photo-01-09-17-12-54-56.jpgvar thisPath = path.dirname(backupArray[cnt]);
														var photoParentDir = normalizeInclWinNetworks(serverParentDir() + outdirPhotos);
														if(verbose == true) console.log("Backing up requested files from script. Photo parent directory");
														if(verbose == true) console.log("photoParentDir=" + photoParentDir);
														var finalFileName = normalizeInclWinNetworks(backupArray[cnt]);
														finalFileName = finalFileName.replace(photoParentDir,"");		//Remove the photo's directory from the filename
											   			if(verbose == true) console.log("finalFileName=" + finalFileName);
											   			var thisPath = normalizeInclWinNetworks(backupArray[cnt]);
											   			if(verbose == true) console.log("thisPath=" + thisPath);
											   			backupFile(thisPath, "", finalFileName, { });
											   		}
											   	}
											   
											   
											   cb(waitForIt, params);
											} else {
												//There is the option of providing a raw file from the photo directory here. Include a blank ""
												returnPhotoFile = "returnPhotoFile:";
												var params = "";
											    if(verbose == true) console.log("Stdout:" + stdout);
											    var returnStart = stdout.lastIndexOf(returnPhotoFile);
											    
											    if(returnStart > -1) {
											   		
											   		params = stdout.substr(returnStart);
											   		params = params.replace("returnPhotoFile:?","");		//remove questions
											   		params = params.replace("returnPhotoFile:","");		//remove questions
											   		params = params.trim();		//remove newlines at the end
											   		if(verbose == true) console.log("Photo file returned=" + params);
											   		
											   		
											   		cb(params, null);		//This will actually serve up this file.
											   		
											   	}
											   
											   	
											
											}
										  
										});
										
										if((evs[cnt].waitForRequestFinish)||(evs[cnt].waitForRequestFinish == "")) {
											//Waiting for completion
										} else {
										
											if(verbose == true) console.log("Checking after request:" + evs[cnt].afterRequest);
											if(evs[cnt].afterRequest) {
												//Forward on to this page afterwards
												 cb(evs[cnt].afterRequest);
											} else {
												cb("");
											}
										}
									}
								}
						
							}
					
						}
					
				
				break;
				
		
				case "displayMenu":
					//TODO: This is another example: display additional items on the main server menu
				break;
		
			};
		}
	});

	return;

}


function trimChar(string, charToRemove) {
    while(string.substring(0,1) == charToRemove) {
        string = string.substring(1);
    }

    while(string.slice(-1) == charToRemove) {
        string = string.slice(0, -1);
    }

    return string;
}

function escapeRegExp(str) {
    return str.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");
}

function replaceAll(str, find, replace) {
  return str.replace(new RegExp(escapeRegExp(find), 'g'), replace);
}


function httpHttpsCreateServer(options) {
	
	//Get the common HTML header here now
	readHTMLHeader(function(err) {
		if(err) {
			console.log(err);
		} else {
	
			if(httpsFlag == true) {
				console.log("Starting https server.");
				https.createServer(options, handleServer).listen(listenPort);


			} else {
				console.log("Starting http server.");
				http.createServer(handleServer).listen(listenPort);
			}
		}
	});

}




function getFileFromUserStr(inFile)
{
		if(verbose == true) console.log("getFileFromUserStr:" + inFile);
		var outFile = inFile;

		outFile = outFile.replace('.jpg','');			//Remove jpg from filename
		outFile = outFile.replace('.jpeg','');			//Remove jpg from filename
		outFile = replaceAll(outFile, "..", "");			//Remove nasty chars
		
		var re = new RegExp("[^" + allowedChars + "]", "g");
		outFile = outFile.replace(re, "");					//Only keep usable chars

		outFile = trimChar(outFile, '/');		//Allowed directory slashes within the filename, but otherwise nothing around sides
		outFile = trimChar(outFile,'\\');



		var words = outFile.split('-');


		var finalFileName = "";
		var outhashdir = "";
		//Array of distinct words
		for(var cnt = 0; cnt< words.length; cnt++) {
			if(words[cnt].charAt(0) == '#') {
				   var getDir = words[cnt].replace('#','');

				   //Do some trimming of this directory name
					getDir = trimChar(getDir, '/');
					getDir = trimChar(getDir, '\\');


				   if(verbose == true) console.log('Comparing ' + getDir + ' with ' + globalId);
				   if(getDir != globalId) {
					   outhashdir = outhashdir + '/' + getDir;
					   if(verbose == true) console.log('OutHashDir:' + outhashdir);
				    }
			} else {
				//Do some odd char trimming of this
				var thisWord = words[cnt];
				thisWord = trimChar(thisWord, '/');
				thisWord = trimChar(thisWord, '\\');

				//Start building back filename with hyphens between words
				if(finalFileName.length > 0) {
					finalFileName = finalFileName + '-';
				}
				finalFileName = finalFileName + thisWord;
			}
		}  //end of loop
	
		finalFileName = finalFileName + '.jpg';
		return normalizeInclWinNetworks(outhashdir + '/' + finalFileName);
}


function ltrim(str) {
  if(!str) return str;
  return str.replace(/^\s+/g, '');
}


function getJSONP(url) {
	//Checks if there is a JSONP request, and returns a callback string to use, if so.
	//Otherwise, returns a null.
	//With the returned callback string, str.replace() the 'JSONRESPONSE' with a JSON stringified
	//version of the return object. Use JSON.stringify();
	var jsonpRequest = false;
	var myURL = new URL("http://127.0.0.1" + url);		//Use any old URL at the start. We will 
														//only be looking at the query section, anyway
	var callback = myURL.searchParams.get(jsonpCallback);
	if(callback) {
		if(verbose == true) console.log("Callback : " + callback);
		var retString = callback + "(JSONRESPONSE)";		
		if(verbose == true) console.log("Response : " + retString);
		return retString; 
	} else {
		return null;
	}
}

function removeTempUploadedFile(files) {

	if(verbose == true) console.log("Removing temporary file.");

	if(files && files.file1 && files.file1[0]) {

		var fileName = files.file1[0].path;
		if(verbose == true) console.log("Removing temporary file path " + fileName);
		
		fs.unlink(fileName, (err) => {
			if (err) {
				console.log("There was a problem deleting the temporary file " + fileName + ". " + err);
			} else {

				if(verbose == true) console.log("Temporary file " + fileName + " is deleted.");
			}
		});
	}

}

function handleServer(_req, _res) {

	var req = _req;
	var res = _res;
	var body = [];

	if (req.url === '/api/photo' && req.method === 'POST') {
		// parse a file upload

		var form = new multiparty.Form({maxFilesSize: maxUploadSize});


		form.parse(req, function(err, fields, files) {
		   //Process filename of uploaded file, then move into the server's directory, and finally
		   //copy the files into any backup directories

			if(err) {
			      	console.log("Error uploading file " + JSON.stringify(err))

					var newerr = err;
					res.writeHead(206, {'content-type': 'application/json'});	//206 returns a non-1 value, so will try again. Error code HTTP 400, will return error code 1 in the app.							
					removeTempUploadedFile(files);
					try {
						res.end(JSON.stringify(newerr));
					} catch(err) {
						console.log("Err:" + err);
					}
        			
        			return;

			} else {

				//The standard outdir is the drive from the current server script
				var parentDir = serverParentDir();
				if(verbose == true) console.log("This drive:" + parentDir);
				var outdir = parentDir + outdirPhotos;

	   			if(verbose == true) console.log('Outdir:' + outdir);


	   			if(verbose == true) console.log('Files ' + JSON.stringify(files, null, 4));
				//Use original filename for name
				if(files && files.file1 && files.file1[0]) {

					//Uploaded file exists
					//Confirm is a valid .jpg file


					var buffer = readChunk.sync(files.file1[0].path, 0, 12);
					var fileObj = fileType(buffer);	//Display the file type
					if(fileObj && fileObj.mime) {
						if(verbose == true) console.log("\nDetected " + files.file1[0].originalFilename + " is type " + fileObj.mime);
					} else {
						console.log("\nWarning: Checked and " + files.file1[0].originalFilename + " is an unknown type");
					}
					if((!fileObj)||(!fileObj.mime)) {
						//Not a known binary file - check if it is in our allowed types
						var ext = null;
						
											
						//Not a known binary file. Assume text file.
						//use the file extension itself, if available
						var thisExt = path.extname(files.file1[0].path);
						var possibleExt = null;						
						
						if(thisExt == '.json') {
							//Can check for some basic text format types
							var buffStart = ltrim(buffer.toString());
							if(buffStart[0] === '{') {
								//Looks like a .json file. yes, we can check if this is an allowed type
								possibleExt = ".json";
							} else {
								//Doesn't look like a json file
								console.log("\nError: Sorry, the file " + files.file1[0].originalFilename + " doesn't look like a .json file");
								possibleExt = null;		
							}
							
						} 
						
						if((!possibleExt) && (thisExt != '.json')) {
						
							//For security purposes, we sanitise it to an ascii string, and write over the file
							var fileContents = fs.readFileSync(files.file1[0].path).toString('ascii');
							try {
								fs.writeFileSync(files.file1[0].path, fileContents, 'ascii');
								console.log("\nWarning: The file " + files.file1[0].originalFilename + " was rewritten into text.");				
							} catch(err) {
								console.log("\nError: We could not rewrite this text file. " + err);
								removeTempUploadedFile(files);
								return;
							
							}
							possibleExt = thisExt;
							
						}				
						
					
						
						if(possibleExt) {
							for(var type = 0; type < allowedTypes.length; type++) {
								if(allowedTypes[type].extension === possibleExt) {
									//This is an allowed type
									ext = allowedTypes[type].extension;
									var ext2 = ext;			//The same for the 2nd one to replace
								}
				
							}
						}
						
						if(!ext) {
							//No file-type exists
							removeTempUploadedFile(files);
							
							console.log("\nError uploading file " + files.file1[0].originalFilename + ". Only certain files (e.g. jpg) are allowed.");
			        		res.statusCode = 400;			//Error during transmission - tell the app about it. And stop retrying.
	  						res.end();
	  						  						
							return;
						}
					} else {
						 //A quick check against .jpg images
						 if(fileObj.mime != 'image/jpeg') {
					
							//A binary file, with mime type in fileObj.mime
							for(var type = 0; type < allowedTypes.length; type++) {
									if(fileObj.mime === allowedTypes[type].mime) {
										//This is an allowed type
										ext = allowedTypes[type].extension;
										var ext2 = ext;			//The same for the 2nd one to replace
									}
					
							}
							
							
							if(!ext) {
								//No file-type exists
								removeTempUploadedFile(files);
								
								console.log("\nError uploading file " + files.file1[0].originalFilename + ". Only certain files (e.g. jpg) are allowed.");
								res.statusCode = 400;			//Error during transmission - tell the app about it. And stop retrying.
								res.end();
													
								return;
							}
							
						} else {
					
							//Special case for jpg files
							ext = ".jpg";
							ext2 = ".jpeg";
						}
					
					}





					var title = files.file1[0].originalFilename;

					//Note: we used to have the successful response here
					


					//Copy file to eg. c:/snapvolt/photos
					var outFile = title;
					outFile = outFile.replace(ext,'');			//Remove jpg from filename
					outFile = outFile.replace(ext2,'');			//Remove jpeg from filename
					outFile = replaceAll(outFile, "..", "");			//Remove nasty chars
							
					var re = new RegExp("[^" + allowedChars + "]", "g");
					outFile = outFile.replace(re, "");					//Only keep usable chars


					outFile = trimChar(outFile, '/');		//Allowed directory slashes within the filename, but otherwise nothing around sides
					outFile = trimChar(outFile,'\\');



					var words = outFile.split('-');

					var finalFileName = "";
					var outhashdir = "";
					var firsthashdir = "";
					//Array of distinct words
					for(var cnt = 0; cnt< words.length; cnt++) {
						if(words[cnt].charAt(0) == '#') {
							   var getDir = words[cnt].replace('#','');

							   //Do some trimming of this directory name
								getDir = trimChar(getDir, '/');
								getDir = trimChar(getDir, '\\');


							   if(verbose == true) console.log('Comparing ' + getDir + ' with ' + globalId);
							   if(getDir != globalId) {
							       outhashdir = outhashdir + '/' + getDir;
	            				   if(verbose == true) console.log('OutHashDir:' + outhashdir);
	            				   if(firsthashdir == "") {
	            				   	   //Keep a track of the 1st one
	            				   	  firsthashdir = getDir;
	            				   }
	        				   }
	        				   	
	        					
						} else {
							//Do some odd char trimming of this
							var thisWord = words[cnt];
							thisWord = trimChar(thisWord, '/');
							thisWord = trimChar(thisWord, '\\');

							//Start building back filename with hyphens between words
							if(finalFileName.length > 0) {
								finalFileName = finalFileName + '-';
							}
							finalFileName = finalFileName + thisWord;
						}
					}  //end of loop
					
					
					//If we allow photos to be downloaded by another MedImage Server, check the photo includes
					//a hashfolder at the start of it. Otherwise, tell the client to retry sending.
					//Note for the app ver 2.0.8 there is a bug if you switch from "ID writes a folder" being off
					//into "ID writes a folder" being on, it won't correctly have the hashtag.
					if((global.globalConfig) && (global.globalConfig.allowPhotosLeaving) && (global.globalConfig.allowPhotosLeaving == true)) {
						if(outhashdir == "") {
							//Error case, the client hasn't sent through a hashdir. Get out of here now.
							removeTempUploadedFile(files);
							
							var err = "Error uploading file - Please reconnect your app. No subfolder provided on:" + outFile;
							console.log(err);

							var newerr = err;
							res.writeHead(206, {'content-type': 'application/json'});	//206 returns a non-1 value, so will try again. Error code HTTP 400, will return error code 1 in the app.							
							try {
								res.end(JSON.stringify(err));
							} catch(err) {
								console.log("Err:" + err);
							}
					
							return;
						}
						
						//Check format of 1st hashdir is e.g. "eAxpYRtSSSYknADb9"
						if((firsthashdir.length >= 16)&&(firsthashdir.length <= 20)) {
							//Correct format. Continue.
						
						} else {
							//Error case, the client hasn't sent through a hashdir. Get out of here now.
							removeTempUploadedFile(files);
							
							var err = "Error uploading file - Please reconnect your app. Subfolder in the wrong format: '" + firsthashdir + "' from file:" + outFile;
							console.log(err);

							var newerr = err;
							res.writeHead(206, {'content-type': 'application/json'});	//206 returns a non-1 value, so will try again. Error code HTTP 400, will return error code 1 in the app.							
							try {
								res.end(JSON.stringify(err));
							} catch(err) {
								console.log("Err:" + err);
							}
					
							return;
						}
					
					}

					//Check the directory exists, and create

					if (!fs.existsSync(normalizeInclWinNetworks(parentDir + outdirPhotos))){
				   		if(verbose == true) console.log('Creating dir:' + normalizeInclWinNetworks(parentDir + outdirPhotos));

	   					fsExtra.mkdirsSync(normalizeInclWinNetworks(parentDir + outdirPhotos));
				  		if(verbose == true) console.log('Created OK dir:' + normalizeInclWinNetworks(parentDir + outdirPhotos));

					}

					//Create the final hash outdir
					outdir = parentDir + outdirPhotos + outhashdir;
					if (!fs.existsSync(normalizeInclWinNetworks(outdir))){
						if(verbose == true) console.log('Creating dir:' + normalizeInclWinNetworks(outdir));
						fsExtra.mkdirsSync(normalizeInclWinNetworks(outdir));
						if(verbose == true) console.log('Created OK');

					}



					finalFileName = finalFileName + ext;

					//Move the file into the standard location of this server
					var fullPath = outdir + '/' + finalFileName;
					if(verbose == true) console.log("Moving " + files.file1[0].path + " to " + fullPath);
					
					var thisRes = res;
					mv(files.file1[0].path, fullPath, {mkdirp: true},  function(err) { //path.normalize(
						  // done. it tried fs.rename first, and then falls back to
						  // piping the source file to the dest file and then unlinking
						  // the source file.	
						  
						  					  
						  if(err) {
						  	//There was an error moving the file. We need to delete the original file now,
						  	//allowing for the app to try sending it again.
							console.log(err);
							try {
								fs.unlinkSync(files.file1[0].path);
								
							} catch(err) {
								console.log("Error removing file:" + err);
							
							}
							
							try {
								fs.unlinkSync(fullPath);								
							} catch(err) {
								console.log("Error removing file:" + err);
							
							}
							
							console.log("Error moving file. We have removed any files, and will let the app try again.");
							var err = {
								msg: "Error: Copying problem on the server." 
							}
							thisRes.writeHead(206, {'content-type': 'application/json'});	//206 returns a non-1 value, so will try again. Error code HTTP 400, will return error code 1 in the app and stop there.							
        					try {
        						thisRes.end(JSON.stringify(err));		
			        		} catch(err) {
			        			console.log("Err:" + err);
			        		}
	  						return;

						  } else {
						  	thisRes.writeHead(200, {'content-type': 'text/plain'});
							var returnStr = 'Received upload successfully!';
							if(verbose == true) returnStr += 'Check ' + normalizeInclWinNetworks(parentDir + outdirPhotos) + ' for your image.';
				  			thisRes.write(returnStr + '\n\n');
				  			thisRes.end();
						  
						  
						  
							console.log('\n' + finalFileName + ' file uploaded');

							//Ensure no admin restictions on Windows
							ensurePhotoReadableWindows(fullPath);
							
							
							
							
							
							
								 
							//Run the addons events on this new photo
							if(ext === ".jpg") {
								var event = "photoWritten";
							} else {
								var event = "fileWritten";
							}
							
							
							
							addOns(event, function(err, normalBackup) {
								if(err) {
									console.log("Error writing file:" + err);
								} else {
									if(verbose == true) console.log("Add-on completed running");
						
								}
						
								if(normalBackup == true) {
									//Now we have finished processing the file via the addons,
									//backup the standard files if 'normal' is the case
							
									//Now copy to any other backup directories
									if(verbose == true) console.log("Backups:");
									var thisPath = fullPath;

									//Now backup to any directories specified in the config
									backupFile(thisPath, outhashdir, finalFileName, { });
								}
							}, fullPath);
								
							
							
							

						  }
					});
				} else { //End of file exists
					//No file exists
					console.log("Error uploading file. No file on server.");
			        	res.statusCode = 400;			//Error during transmission - tell the app about it
	  				res.end();
					return;
				}

			}	//End of form no parse error









		}); //End of form.parse

		return;

	} else {  //end of api upload

		//Start ordinary error handling
		req.on('error', function(err) {
		  // This prints the error message and stack trace to `stderr`.
		  console.error(err.stack);

		  res.statusCode = 400;			//Error during transmission - tell the app about it
		  res.end();
		});
		
		req.on('data', function(chunk) {
			//It is not an array! body.push(chunk);
			body += chunk;
			
			// 1e6 === 1 * Math.pow(10, 6) === 1 * 1000000 ~~~ 1MB
            if (body.length > 1e6) { 
                // FLOOD ATTACK OR FAULTY CLIENT, NUKE REQUEST
                req.connection.destroy();
            }
		});

		req.on('end', function() {

			if(flapSimulation == true) {
				if(flapState == true) {
					flapState = false;
					
					return;			//Exit here prematurely to simulate flapping
				} else {
					flapState = true;
				}
			
			}


			//A get request to pull from the server
			// show a file upload form
			if(req.method === "GET") {
				var url = req.url;
			} else {	
				//A post request
				if(body) {
					var url = req.url + '?' + body;
				} else {
					var url = req.url;
				}
			}
			if((url == '/') || (url == "") || (url == "/index.html")) {
				  url = "/pages/index.html";

				  //The homepage has a custom string of the number of bytes transferred
				  var formattedBytes = formatBytes(bytesTransferred, 1);
				  var customString = { "CUSTOMSTRING": formattedBytes };

				  if(allowGettingRemotePhotos == false) {
				   		//If we can't sync, don't try - switch off the buttons
				   		customString.SYNCING =  "false";

				  } else {
				  		customString.SYNCING =  "true";
				  }
				  
				  //Get from the current global config.
				  if(global.globalConfig.countryCode) {
				  		customString.COUNTRYCODE = global.globalConfig.countryCode;
				  } else {
				  		customString.COUNTRYCODE = "";
				  }
				  if(global.globalConfig.style) {
				  		customString.STYLE = global.globalConfig.style;
				  } else {
				  		customString.STYLE = "none";
				  }
				  if(global.globalConfig.proxy) {
				  		customString.PROXY = global.globalConfig.proxy;
				  } else {
				  		customString.PROXY = "";
				  }
				   if(global.globalConfig.lockDown) {
				   		if(global.globalConfig.lockDown == true) {
				  			customString.LOCKDOWN = "true";
				  		} else {
				  			customString.LOCKDOWN = "false";
				  		}
				  } else {
				  		customString.LOCKDOWN = "false";
				  }
				  
				  


			} else {
			  	//Mainly we don't have any custom strings
			  	var customString = null;
			}

			var removeAfterwards = false;
			var read = '/read/';
			var pair = '/pair';
			var check = '/check=';
			var addonreq = '/addon/';
			var load = '/load/';

			if(verbose == true) console.log("Url requested:" + url);

			if(url.substr(0,load.length) == load) {
				//Get a load average and output it as a JSON array snippet
				res.writeHead(200, {'content-type': 'text/html'});
				res.end(JSON.stringify(os.loadavg()));
				return;
			
			}

			if(url.substr(0,pair.length) == pair) {
				   //Do a get request from the known aj server (that is the default, at least)
				   //for a new pairing guid
				   var fullPairingUrl = pairingURL;
					
				   var queryString = url.substr(pair.length);		


				   checkConfigCurrent(null, function() {
					   
					   //Split the url into separate vars for a post below
					   var data = {};			//Incoming data from url
					   var vars = queryString.split('&');
					   for (var i = 0; i < vars.length; i++) {
							var pair = vars[i].split('=');
							if(pair[0][0] == "?") {
								//Remove first char
								pair[0] = pair[0].substr(1);
							}
							data[pair[0]] = decodeURIComponent(pair[1]);
							
					   }
					   
					   
					
					   
					   
					   if(globalId != "") {
					   	//We already know the global id - use it to update the passcode only
					   	data.guid = globalId;
					   	
					   }
					   
					   if(data.customPairing) {
					   	   //Allow a custom pairing server (not atomjump's own)
					   	   fullPairingUrl = data.customPairing + queryString;					   
					   } else {
							//Use AtomJump's own pairing server
						   if(queryString) {
							   fullPairingUrl = fullPairingUrl + queryString;

						   }
					   }
					   console.log("Request for pairing:" + fullPairingUrl);
					   
					   var options = {};
					   if(webProxy) {
					   	 options.proxy = webProxy;
					   } 
					   options.follow = 1;		//Allow redirection once to the secure page.
					   
					   
					  

					   needle.post(fullPairingUrl, data, options, function(error, response) {
					   
					   	  var store = {};			//What to store to our local config file
					   	  store.setReadProxy = null;
					   
					   	  if(data.country) {
					   		store.setCountryCode = data.country;
					   	  } else {
					   	    store.setCountryCode = null;
					   	  }
						  if(data.proxyServer) {
							 store.setProxy = data.proxyServer;
						  }	
						  if(data.style) {
						  	 store.setStyle = data.style;
						  }
						  
					   
						  if(error) {
						  		console.log("Pairing error:" + error);
						  		var replace = {
							   	 "CUSTOMCODE": "[Pairing error: " + error + "]",
							   	 "CUSTOMCOUNTRY": "[Unknown]",
							   	 "STANDARDHEADER": htmlHeaderCode
							   };

							   //Write full proxy to config file
							   checkConfigCurrent(store, function() {


								   //Display passcode to user
								   var outdir = __dirname + "/../public/pages/passcode.html";
								   serveUpFile(outdir, null, res, false, replace);
								   return;
							   });
						  } else {
						  
						  	if (response.statusCode == 200) {
							  console.log(response.body);
							
							   
							
							   var codes = response.body.split(" ");
							   var passcode = codes[0];
							   newGlobalId = validateGlobalId(codes[1]);
							   if(newGlobalId !== false) {
							   	   globalId = codes[1];
   						   		   var guid = globalId;
								   var proxyServer = codes[2].replace("\n", "");
								   if(codes[3]) {
									var country = decodeURIComponent(codes[3].replace("\n", ""));
									
								   } else {
									//Defaults to an unknown country.
									var country = "[Unknown]";
								   }
								   
								   store.setReadProxy = proxyServer + "/read/" + guid;
							   	   console.log("Proxy set to:" + store.setReadProxy);
							   } else {
							   	   passcode = "----";
							       var country = "[Sorry there was a problem contacting the pairing server. Please try again, or check 'Service Status'.]";
							   }
							  
							   

							   var replace = {
							   	 "CUSTOMCODE": passcode,
							   	 "CUSTOMCOUNTRY": country,
							   	 "STANDARDHEADER": htmlHeaderCode
							   };

							   //Write full proxy to config file
							   checkConfigCurrent(store, function() {


								   //Display passcode to user
								   var outdir = __dirname + "/../public/pages/passcode.html";
								   serveUpFile(outdir, null, res, false, replace);
								   return;
							   });


						  	} else {
						  		//No connection available
						  		console.log("Pairing error:" + error + " Status: " + response.statusCode);
						  		var replace = {
							   	 "CUSTOMCODE": "[Pairing error: " + error + " Status: " + response.statusCode + "]",
							   	 "CUSTOMCOUNTRY": "[Unknown]",
							   	 "STANDARDHEADER": htmlHeaderCode
							   };

							   //Write full proxy to config file
							   checkConfigCurrent(store, function() {


								   //Display passcode to user
								   var outdir = __dirname + "/../public/pages/passcode.html";
								   serveUpFile(outdir, null, res, false, replace);
								   return;
							   });
						  		
						  	} 
						  }
					   });
				   });


	   			} else {		//end of pair


				  if(url.substr(0,read.length) == read) {

					 var jsonpResponse = getJSONP(url);		//See if we have a JSONP request
					 

				  	 if(allowPhotosLeaving != true) {

				  	 		console.log("Read request detected (blocked by config.json): " + url);
				   			res.writeHead(400, {'content-type': 'text/html'});
							res.end("Sorry, you cannot read from this server. Please check the server's config.json.");
				   			return;
				   	  }
				   	  
				   	  //Allow reading from any url - CORS, see https://stackfame.com/nodejs-with-cors
				   	  res.setHeader("Access-Control-Allow-Origin", "*");
					  res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");


					 //Get uploaded photos from coded subdir
					 var codeDir = url.substr(read.length);
					 codeDir = codeDir.split('?')[0];		//Remove anything after a trailing '?', including the question mark itself
					 /* Old way: just removed a trailing question mark by removing the last character: if(codeDir.charAt(codeDir.length-1) == "?") {	//remove trailing question marks
					 	codeDir = codeDir.slice(0, -1);
					 }*/
					 
					 var parentDir = serverParentDir();
					 if(verbose == true) console.log("This drive:" + parentDir);
					 if(verbose == true) console.log("Coded directory:" + codeDir);

					 if(codeDir.length <= 0) {
						 console.log("Cannot read without a directory");
						 return;
					 }

					 var outdir = normalizeInclWinNetworks(parentDir + outdirPhotos + '/' + codeDir);
					 var compareWith = normalizeInclWinNetworks(parentDir + outdirPhotos);

					 if(verbose == true) console.log("Output directory to scan " + outdir + ". Must include:" + compareWith);
					 //For security purposes the path must include the parentDir and outdiePhotos in a complete form
					 //ie. be subdirectories. Otherwise a ../../ would allow deletion of an internal file
					 if(outdir.indexOf(compareWith) > -1) {

						
						 //Get first file in the directory list
						 fileWalk(outdir, function(outfile, mime, cnt) {

							 if(outfile) {
								//Get outfile - compareWith
								outfile = normalizeInclWinNetworks(outfile);
								var localFileName = outfile.replace(compareWith, "");
								if(verbose == true) console.log("Local file to download via proxy as:" + localFileName);
								if(verbose == true) console.log("About to download (eventually delete): " + outfile);

								if(req.method === "HEAD") {
									//Serve the header only
									res.writeHead(200, {'content-type': mime, 'file-name': localFileName });
									res.end();

								} else {
									//Now serve the full file
									serveUpFile(outfile,localFileName, res, true, null, jsonpResponse);
								}

							 } else {
								//Reply with a 'no further files' simple text response to client

								if(verbose == true) {
									console.log("No images");
								} else {
									process.stdout.write(".");
								}
								res.writeHead(200, {'content-type': 'text/html'});
								
								if(jsonpResponse) {
									var response = jsonpResponse.replace("JSONRESPONSE", JSON.stringify(noFurtherFiles));
									if(verbose == true) console.log("JSONP response:" + response);
									res.end(response);
								} else {
									//A normal response
									res.end(noFurtherFiles);
								}
								return;

							 }
						 });
					 } else {		//end of outdir compare
						console.log("Security exception detected in " + outdir);
						return;
					 }

				   } else {  //end of url read


						
						if(url.substr(0,check.length) == check) {
							
							//Right, do a check to see if the photo file exists already on the server
							//The request would be e.g. /check/hfghhgm34gd/path/file.jpg
							
							if(allowPhotosLeaving != true) {
									console.log("Read request detected (blocked by config.json): " + url);
									res.writeHead(400, {'content-type': 'text/html'});
									res.end("Sorry, you cannot read from this server. Please check the server's config.json.");
									return;
							  }
							  
							//Check uploaded photo exists from coded subdir
							var codeFile = decodeURIComponent(url.substr(check.length));
							
							
							
							 
							var parentDir = serverParentDir();
							if(verbose == true) console.log("This drive:" + parentDir);
							if(verbose == true) console.log("Coded file:" + codeFile);

							if(codeFile.length <= 0) {
							   console.log("Cannot read without a file");
							   return;
							}

							var checkFile = getFileFromUserStr(codeFile);
							var fullCheck = parentDir + outdirPhotos + checkFile;
							if(verbose == true) console.log("Checking file:" + fullCheck);
							  
							//Check file exists async
							fs.stat(fullCheck, function(ferr, stat) {
								if((ferr == null)&&(stat.isFile() == true)) {		//Note: it must be a full filename, to prevent bulk checks for the directories
									//File exists
									res.writeHead(200, {'content-type': 'text/html'});
									res.end("true");
									if(verbose == true) console.log("true");
									return;
									
								} else {
									//File doesn't exist
									res.writeHead(200, {'content-type': 'text/html'});
									res.end("false");
									if(verbose == true) console.log("false");
									return;
								}
							});
							
							
						
						} else {	//end of check read


							if(url.substr(0,addonreq.length) == addonreq) {
								//So it is an addon's request
								//Read the addon config, and determine what to do
								var thisQueryString = url.substr(addonreq.length);
								var newLocation = "";
								
								
								
								/*E.g. var replace = {
							   	 "CUSTOMIMAGE": "yo/10-Aug-2017-09-21-45.jpg",
							   	 "CUSTOMWOUNDIMAGE": "yo/10-Aug-2017-09-21-45.wound-view.jpg",
							   	 "CUSTOMAREA": "123456"
							   };*/
								
								
								addOns("urlRequest", function(newLocation, params) {
								
									//Close off the request to the browser
									if(newLocation != "") {
								
										if(params) {
											var replace = queryStringLib.parse(params);
										} else {
											var replace = null;
										}
										
										if((replace) && (replace.CHANGELOCATION)) {
											newLocation = replace.CHANGELOCATION;
										
										}
										
										if(replace) {
											replace.STANDARDHEADER = htmlHeaderCode;		//Set the header to the startup header code
										}
																				
										var outdir = __dirname + "/../public/pages/" + newLocation;
										if(verbose == true) console.log("Serving up file:" + outdir);
										
										//Since this is dynamic content we don't want to cache it.
										if((res.headersSent) && (res.headersSent == true)) {
											//Sorry, the header has already been sent
										} else {
											res.setHeader("Cache-Control", 'private, no-cache, no-store, must-revalidate');
											res.setHeader("Expires", "-1");
											res.setHeader("Pragma", "no-cache");
										}
										
										serveUpFile(outdir, null, res, false, replace);
									} else {
										//Just complete the browser request
										if(verbose == true) console.log("Completing browser request");
										res.writeHead(200, {'content-type': 'text/html'});
										res.end();
									}
								
								
								}, thisQueryString);
								
									
								
							} else {

								//Get a front-end facing image or html file
								var outdir = __dirname + "/../public" + url;

								if(customString) {
									customString.STANDARDHEADER = htmlHeaderCode;		//Set the header to the startup header code
								} else {
									
									if((url.endsWith(".html"))&&(url !== "snippet.html")) {		//We don't want to continually pass this header data around snippets
										//Yes, will likely need the standard header
										var customString = {};
										customString.STANDARDHEADER = htmlHeaderCode;
									
									}
								}
								
								serveUpFile(outdir, null, res, false, customString);
							}
						}
				   }
		  	} //end of check for pairing

		}); //Request end end
	}	//end of ordinary file processing
}


function serveUpFile(fullFile, theFile, res, deleteAfterwards, customStringList, jsonpResponse) {

  //CustomStringList should be in format:
  //  {
  //     "STRINGTOREPLACE1": withValue1,
  //     "STRINGTOREPLACE2": withValue2
  //  }

  
  var sections = normalizeInclWinNetworks(fullFile).split("?");
  var normpath = sections[0];		//Ignore any query parameters to the right	

  if(verbose == true) console.log(normpath);
	
	
	
  // set the content type
  var ext = path.extname(normpath);
  var contentType = 'text/html';
  var stream = true;

  if(customStringList) {
  	//Likely html which we need to load in and edit before sending
  	stream = false;

  }

  //Handle images
  if (ext === '.png') {
	 contentType = 'image/png';
	 stream = false;
  }
  if (ext === '.jpg') {
	 contentType = 'image/jpeg';
	 stream = false;
  }

  if(ext === '.svg') {
  	contentType = 'image/svg+xml';
  	stream = false;		//for some reason svg doesn't like being streamed
  }

  if(ext === '.css') {
    contentType = 'text/css';
  }
  

  
  //Run through the user-defined file types
  for(var type = 0; type < allowedTypes.length; type++) {
  	if(ext === allowedTypes[type].extension) {
  		contentType = allowedTypes[type].mime;
  		if(verbose == true) console.log(contentType);
  	}
  
  }
  

  //Being preparation to send



  if(((stream == false)&&(deleteAfterwards != true))||
  		(jsonpResponse)) {
	//Implies we need to modify this file, and it is likely and html request - i.e. fairly rare
  	//Use the slow method:  	
  	fs.readFile(normpath, function (err,data) {

	  if (err) {
	   	res.writeHead(404);
	   	res.end(JSON.stringify(err));
	   	return;
	  }

	  
	  if((contentType != 'image/jpeg')&&
	     (contentType != 'image/png')) {
	     	     
	     //This is use for a replace on an HTML file with custom strings
	     var strData = data.toString();

	     for (var key in customStringList) {
	     	 strData = strData.replace(new RegExp(key, 'g'), customStringList[key]);
  
	     }

		 try {
	     	data = JSON.parse( JSON.stringify( strData ) ); 
	     } catch(e) {
	     	//Unparsable
	     	data = {};
	     
	     }
	  }	  

	  res.on('error', function(err){
	  	//Handle the errors here
	  	res.statusCode = 400;
    	res.end();
	  })

	  if((res.headersSent) && (res.headersSent == true)) {
	    	//Sorry, the header has already been sent
	  } else {
	  	res.writeHead(200, {'Content-Type': contentType, 'file-name': theFile});		//Trying with cap Content-Type, was content-type
	  }

		if(verbose == true) console.log("About to serve file jsonpResponse: " + jsonpResponse);
		if(verbose == true) console.log("About to serve file contents: " + JSON.stringify(data));
		if(jsonpResponse) {
			//A JSONP request - e.g. for a message file from an iPhone
			var response = jsonpResponse.replace("JSONRESPONSE", JSON.stringify(data));
			if(verbose == true) console.log("Full JSONP response: " + response);	
				
			res.end(response, function(err) {
			  //Wait until finished sending, then delete locally
			  if(err) {
				 console.log(err);
			  } else {
				//success, do nothing
			
				if(deleteAfterwards == true) {
					//Delete the file 'normpath' from the server. This server is like a proxy cache and
					//doesn't hold permanently

					//Note: we may need to check the client has got the full file before deleting it?
					//e.g. timeout/ or a whole new request.
					if(verbose == true) console.log("About to shred:" + normpath);
					shredWrapper(normpath, theFile);
				

				}

			 }
		   });
		} else {
			//A normal response
			res.end(data, function(err) {
			  //Wait until finished sending, then delete locally
			  if(err) {
				 console.log(err);
			  } else {
				//success, do nothing
			
				if(deleteAfterwards == true) {
					//Delete the file 'normpath' from the server. This server is like a proxy cache and
					//doesn't hold permanently

					//Note: we may need to check the client has got the full file before deleting it?
					//e.g. timeout/ or a whole new request.
					if(verbose == true) console.log("About to shred:" + normpath);
					shredWrapper(normpath, theFile);
				

				}

			 }
		   });
		}
	  
	 });  //End of readFile
   } else {	//End of if custom string

  		//Use streams instead for a larger file

  	     //Still pipe a mime type back
  	     if((res.headersSent) && (res.headersSent == true)) {
	    	//Sorry, the header has already been sent
	  	 } else {
  	         res.writeHead(200, {'content-type': contentType, 'file-name': theFile});
		 }

		  //Read the file from disk, then send to client
		  var stream = fs.createReadStream(normpath);
		  stream.on('error', function(err) {
		  	console.log(JSON.stringify(err))

			return;
		  })

		  stream.on('end', function() {

		  	 if(deleteAfterwards == true) {
				//Delete the file 'normpath' from the server. This server is like a proxy cache and
				//doesn't hold permanently

				//Note: we may need to check the client has got the full file before deleting it?
				//e.g. timeout/ or a whole new request.
				if(verbose == true) console.log("About to shred:" + normpath);
				shredWrapper(normpath, theFile);


			}
		  });

		  stream.on('finish', function() {
		  	console.log("On finish event");
		  });

		  stream.pipe(res);
	}  //end of streams

}

//This section runs on startup.
checkConfigCurrent(null, function(err) {

	if(err) {
		console.log("Error updating config.json: " + err);
		process.exit(0);
	}

	httpHttpsCreateServer(serverOptions);  //end of createServer
}); //end of checkConfigCurrent
