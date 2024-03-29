/*

Unzips, and then runs each of the commands in a 


*/




var url = require("url");
var path = require("path");
var unzip = require('unzipper');
var request = require('request');
var path = require("path");
var upath = require("upath");
var queryString = require('querystring');
var http = require('http');
var https = require('https');
var fs = require('fs');
var fsExtra = require('fs-extra');
var async = require('async');
var exec = require('child_process').exec;
var spawn = require('child_process').spawn;


/*
Old way of using the entities interface for ver 1.3.1, which is the supported interface
for the old Windows Server < 1.8.4:
const Entities = require('html-entities').AllHtmlEntities;
 
const entities = new Entities();

*/ 

var Entities = require('html-entities');
var encode = Entities.encode;



var httpsFlag = false;				//whether we are serving up https (= true) or http (= false)
var serverOptions = {};				//default https server options (see nodejs https module)
var verbose = false;


var configFile = __dirname + '/../../config.json';
var targetAddonsFolder = __dirname + "/../";
var tempDir = 'temp-installation/';
var descriptorFile = "medimage-installer.json";



function normalizeInclWinNetworks(path)
{
	//Tests to see if the path is a Windows network path first, if so, handle this case slightly differently
	//to a normal upath.normalization.
	//Run this before 
	if((path[0] == "\\")&&(path[1] == "\\")) {
		
		return "\/" + upath.normalize(path);		//Prepend the first slash
	} else {
		if((path[0] == "\/")&&(path[1] == "\/")) {
			//In unix style syntax, but still a windows style network path
			return "\/" + upath.normalize(path);		//Prepend the first slash
		} else {
			return upath.normalize(path);
		}
	}

}


function getMasterConfig(defaultConfig, callback) {
	exec("npm get medimage:configFile", {
			maxBuffer: 2000 * 1024 //quick fix
		}, (err, stdout, stderr) => {
		  if (err) {
			// node couldn't execute the command
			console.log("There was a problem running the addon. Error:" + err);
			callback(err, "");
	
		  } else {
			  if((stdout != "")&&(!stdout.startsWith("undefined"))) {
			  	 callback(null, stdout.trim());
			  
			  } else {
			  	 callback("Global not set", null);
			  
			  }		
		  }
	});		//End of the exec
}

function havePermission(configFile, cb) {
	//Checks config to see if we have permissions
	//Returns true or false


	getMasterConfig(configFile, function(err, masterConfigFile) {
		if(err) {
			//Leave with the configFile
		} else {
			configFile = masterConfigFile;		//Override with the global option
		}
		console.log("Using config file:" + configFile);

		//Write to a json file with the current drive.  This can be removed later manually by user, or added to
		fs.readFile(configFile, function read(err, data) {
			if (err) {
					cb("Sorry, cannot read config file! " + err);
			} else {
				var content = JSON.parse(data);


				if(content.lockDown == false) {	//For security purposes, only allow this change through the interface if we are a client machine

					cb(null, true);
					
				} else {
			
					cb(null, false);
				}
			


			};
		});
	});

}


function noTrailSlash(str)
{
	if(str.slice(-1) == "/") {
		return str.slice(0,-1);	//Chop off last char
	} else {
		return str;
	}

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



function unzipAndRemoveNew(filename, tmpFilePath, cb) {
	 //filename is e.g. 'medimage-addon-ehr-medtech32-0.0.4.zip'
	 //tmpFilePath is the full path e.g. 'C:/medimage/addons/medimage-addon-ehr-medtech32-0.0.4.zip'
	 //Convert filename into one without extension
	 var possFileName = filename.replace(/.zip/i, "") + "/";
	 
	 try {

		fs.createReadStream(tmpFilePath).pipe(unzip.Extract({ path: targetAddonsFolder + tempDir }))
			.on('close', function() {
		  	  console.log("Finished");
		  	 		
				//Check if our files are one directory in
				var dir = "";
				var fileCnt = 0;
				var dirCnt = 0;
				
				fs.readdirSync(targetAddonsFolder + tempDir).forEach(file => {
				  if(verbose == true) console.log(file);
				  if(fs.lstatSync(targetAddonsFolder + tempDir + '/' + file).isDirectory()) {
				  	if(verbose == true) console.log("Is a directory");
				  	dir = file;
				  	dirCnt ++;
				  } else {
				  	if((file[0] == '.')||(file == filename)) {
				  		if(verbose == true) console.log("Is a hidden file - not counted");
				  	} else {
						if(verbose == true) console.log("Is a file");
						fileCnt ++;
					}
				  }
				})
				
				if((fileCnt == 0)&&(dirCnt == 1)) {
					//Yes at least one directory in
					var dirName = dir;
					
					//Now check if we're two directories in
					var fileCnt = 0;
					var dirCnt = 0;
					var dir = "";
					
					fs.readdirSync(targetAddonsFolder + tempDir + '/' + dirName).forEach(file => {
					  if(verbose == true) console.log(file);
					  if(fs.lstatSync(targetAddonsFolder + tempDir + '/' + dirName + '/' + file).isDirectory()) {
						if(verbose == true) console.log("Is a directory");
						dir = file;
						dirCnt ++;
					  } else {
						if(file[0] == '.') {
							if(verbose == true) console.log("Is a hidden file - not counted");
						} else {
							if(verbose == true) console.log("Is a file");
							fileCnt ++;
						}
					  }
					})
					
					if((fileCnt == 0)&&(dirCnt == 1)) {
						//Yes, we're two directories in. Append this to the output directory
						dirName = dirName + "/" + dir;
					
					}
					
					
				
				} else {
				
					var dirName = "";
				}
		
				console.log("Output dirname = '" + dirName +"'");
		
				 
				 //Remove the temporary .zip file
				 fs.unlink(tmpFilePath, function(err) {
					if(err) {
						cb(err, null);
					} else {
						cb(null, dirName);
					}
				 });		//Remove the zip file itself
				 
		
			  });		
	 } catch(err) {
			console.log("returnParams:?FINISHED=false&TABSTART=install-addon-tab&MSG=There was a problem unzipping the file.&EXTENDED=" + err + "  Expected folder:" + tempDir);
			process.exit(0);				 
	 }	
	 
	

} 





//With thanks from http://rajiev.com/download-an-extract-a-zip-file-with-node-js/
function downloadAndUnzip(filename, url, opts, cb) {
	var tmpFilePath = targetAddonsFolder + tempDir + filename;
	fsExtra.ensureDir(targetAddonsFolder + tempDir, function(err) {
		 if(err) {
		 		cb(err, null) // => null
		 } else {
				// dir has now been created, including the directory it is to be placed in
				
								  
				var stream = request({url: url, forever: true, followAllRedirects: true });
				var alreadyClosed = false;
				stream.pipe(fs.createWriteStream(tmpFilePath)
								.on('error', function(err) {
									console.log("Error writing to file");
									cb(err, null);
								})
							)
					.on('close', function() {

						console.log("Downloaded successfully!" + tmpFilePath);
						if(alreadyClosed == false) {
							alreadyClosed = true;

							//Downloaded in here
							unzipAndRemoveNew(filename, tmpFilePath, cb);
							
						} else {
							console.log("2nd close event");
						}
					});  
				   
				  
		}
	})
	

}

function removeUnreadableChars(str)
{
	str = str.replace(/\&quot\;/g, '');
	str = str.replace(/\&\#10\;/g, '');
	return str;
}


function execCommands(commandArray, prepend, cb) 
{
		//Asyncronously call each item, but in sequential order. This means the process could
		//be doing something processor intensive without holding up the main server, but still allow
		//each add-on to potentially process sequentially. 
		
		var commandStatus = "success";
		var commandMessage = "";
		
		async.eachOfSeries(commandArray,
					// 2nd param is the function that each item is passed to
					function(runBlock, cnt, callback){
				
						var timeOut = 400000;			//For a maximum worst case longest install time (400 seconds ~ 6 minutes)
						var timedOut = false;			//If we timed out - affects whether we report an error or keep the current warning/error status
				
				
						if(commandArray[cnt].attempt) {
							//Will make an attempt
							var cmd = prepend + commandArray[cnt].attempt;
							
							if(commandArray[cnt].timeoutAfterSeconds) {
								timeOut = commandArray[cnt].timeoutAfterSeconds * 1000;
									
							}
							
							if(commandArray[cnt].warnOnTimeout) {
								var warningMessage = commandArray[cnt].warnOnTimeout;							
							}
						} else {
				
							var cmd = prepend + commandArray[cnt];
						}
						console.log("Running command: " + cmd);
						
						var runningOutput = "";
						
						var outputStdOut = "";
						var outputStdError = "";
							  
						try {
							  
							  
							  
							  
							  //Do it the better spawn way
								cmds = cmd.split(" ");
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
									  if(code != 0) {
								  
										  //Error. Code in 'code'
										  // node couldn't execute the command
											var msg = "Command: " + cmd + ". Error:" + outputStdError;
											console.log(msg);
										
											//Send to the log anyway
											console.log("Stdout:" + outputStdOut);
											console.log("Stderr:" + outputStdError);
										
										
											//Get rid of any strange chars before sending back to GUI
											msg = encode(msg, {mode: 'extensive', level: 'all'}); //Old style: entities.encodeNonUTF(msg);
								
											//Remove newlines
											msg = removeUnreadableChars(msg).substr(0,500);
										
											
										
											if(timedOut == false) {
												commandStatus = "error";
												commandMessage = "The installation was not complete. There was a problem running one of the installation commands. " + msg;
											} else {
												//Keep the timeout message
											}
											callback(commandMessage, commandStatus);
									 } else {
										   //Success
										   console.log("Stdout from command:" + outputStdOut);
										   callback(null, commandStatus);
									 
									 }
								});	
								
								
								if(timeOut) {
								 	 //Kill the process after too long
								 	 setTimeout(function(){ 
								 	 	if(commandArray[cnt].warnOnTimeout) {
								 	 		commandMessage = commandMessage + commandArray[cnt].warnOnTimeout;
								 	 		commandStatus = "warn";
								 	 	} else {
								 	 		commandMessage = commandMessage + " The installation command timed out and was not complete."
								 	 		commandStatus = "error";
								 	 	
								 	 	}
								 	 	timedOut = true;
								 	 	
								 	 	if((platform == 'win32')||(platform == 'win64')) {
								 	 		console.log(running.pid + " timed out");
								 	 		//This won't work: running.kill();, See: https://stackoverflow.com/questions/32705857/cant-kill-child-process-on-windows
								 	 		
								 	 		exec('taskkill /pid ' + running.pid + ' /T /F');
								 	 	} else {
								 	 	
								 	 		console.log(running.pid + " timed out");
  											process.kill(running.pid, 'SIGHUP');
  										}
								 	 	
								 	 	
								 	 }, timeOut);
								 }	
								
						
						
						 } catch(err) {
						 		var msg = "There was a problem running the command " + cmd;
						 		var ext = err;
						 	
						 		console.log("Error:" + err);
						 		console.log("Stdout:" + outputStdOut);
						 		console.log("Stderr:" + outputStdError);
						 	
						 		//Get rid of any strange chars
						 		ext = encode(msg, {mode: 'extensive', level: 'all'});		//Old style: entities.encodeNonUTF(ext);
						 		
						 		//Remove newlines
						 		
						 		ext = removeUnreadableChars(msg).substr(0,500);	
						 		commandMessage = "The installation was not complete. There was a problem running the one of the installation commands.&EXTENDED=" + cmd + " Error:" + ext;
						 		
						 		commandStatus = "error";
						 		callback(commandMessage, commandStatus);
						 
						 }
					
					  },	//End of async eachOf single item
					  function(err){
						// All tasks are done now
						console.log("All tasks finished");
						 if(err) {
						   //Pass back status, and any error message
						   cb(err, commandStatus);
						 } else {
						   console.log('Completed all commands successfully!');
						   if(commandStatus == "warn") {
						   	 //Send back the warning in the 'error' field
						   	 cb(commandMessage, commandStatus);
						   } else {
						   	 cb(null, commandStatus);
						   }
						 }
					   }
		); //End of async eachOf all items


}



function openAndRunDescriptor(directory, opts)
{
	var commandStatus = "success";		//Assume success unless we know otherwise. This can be "warn", "error" or "success" at the end.
	var commandMessage = "";			//We hold a running list of any warnings in this string, the get appended to each other.


	//Change into the directory of the add-on
	try {
		process.chdir(directory);
	} catch(err) {
		return console.log("returnParams:?FINISHED=false&TABSTART=install-addon-tab&MSG=This is not a directory.&EXTENDED=" + err);
		process.exit(0);
	}
	var desc = directory + "/" + descriptorFile;
	console.log("Checking installer file " + desc);
	
	if(fs.existsSync(desc) == true) {
		try {
			var data = fsExtra.readJsonSync(desc);
		} catch(err) {
			console.log("Error: there was a problem in the medimage-installer .json file. " + err);
			console.log("returnParams:?FINISHED=false&TABSTART=install-addon-tab&MSG=There was a problem in the medimage-installer .json file.&EXTENDED=" + err);
			process.exit(0);
		
		}
		
		
		if(data) {
			//Yes there is an installer script to run
			if(data.installCommands) {
				
				//Determine our current platform
				var platform = getPlatform();
				async.waterfall([
					function(callback) {
						console.log("Checking all platform commands");
						if(data.installCommands.all) {
							//Run through these commands always - all platforms	
							var prepend = "";
							if((platform == "unix")||(platform == "mac")) {
								if(opts.password != "") {
									prepend = "echo \"" + opts.password + "\" | sudo -S ";
								}
							}
							execCommands(data.installCommands.all, prepend, function(err, type) {
								if(type == "warn") {
									commandMessage = commandMessage + " " + err;
									callback(null);		//Don't pass along the error message
								} else {
									callback(err);		//err could either be nothing or a genuine error
								}
							});
						} else {
							callback(null);
						}
					},
					function(callback) {
						console.log("Checking Win32 commands");
						if((data.installCommands.win32) && (platform == "win32")) {
							//Run through these commands on Win32
							execCommands(data.installCommands.win32, "", function(err, type) {
								if(type == "warn") {
									commandMessage = commandMessage + " " + err;
									callback(null);		//Don't pass along the error message
								} else {
									callback(err);		//err could either be nothing or a genuine error
								}
							});
						} else {
							callback(null);
						}
					},
					function(callback) {
						console.log("Checking Win64 commands");
						if((data.installCommands.win64) && (platform == "win64")) {
							//Run through these commands on Win64
							execCommands(data.installCommands.win64, "", function(err, type) {
								if(type == "warn") {
									commandMessage = commandMessage + " " + err;
									callback(null);		//Don't pass along the error message
								} else {
									callback(err);		//err could either be nothing or a genuine error
								}
							});
						} else {
							callback(null);
						}
					},
					function(callback) {
						console.log("Checking Unix commands");
						if((data.installCommands.unix) && (platform == "unix")) {
							//Run through these commands on unix/linux
							if(opts.password != "") {
								var prepend = "echo \"" + opts.password + "\" | sudo -S ";
							} else {
								var prepend = "";
							}
							execCommands(data.installCommands.unix, prepend, function(err, type) {
								if(type == "warn") {
									commandMessage = commandMessage + " " + err;
									callback(null);		//Don't pass along the error message
								} else {
									callback(err);		//err could either be nothing or a genuine error
								}
							});
						} else {
							callback(null);
						}
					},
					function(callback) {
						console.log("Checking Mac commands");
						if((data.installCommands.mac) && (platform == "mac")) {
							//Run through these commands on mac
							if(opts.password != "") {
								var prepend = "echo \"" + opts.password + "\" | sudo -S ";
							} else {
								var prepend = "";
							}
							execCommands(data.installCommands.mac, prepend, function(err, type) {
								if(type == "warn") {
									commandMessage = commandMessage + " " + err;
									callback(null, 'done');		//Don't pass along the error message
								} else {
									callback(err, 'done');		//err could either be nothing or a genuine error
								}
							});
						} else {
							callback(null, 'done');
						}
					}
				], 
				function (err, result) {
					// result now equals 'done'
					if(err) {
						console.log("The installation was not complete.");
						console.log("returnParams:?FINISHED=false&TABSTART=install-addon-tab&MSG=" + err);

						process.exit(0);
					} else {
					
						//Success, installing - now display a standard message, unless the installer json knows differently
						var mainMessage = "The installation was completed successfully!";
						var extendedMessage = "";
						
						if(data.successMessages) {
							
							
							if(data.successMessages.all) {
								//Any platform unspecific message? This will override the default.
								if(data.successMessages.all.main) {
									mainMessage = data.successMessages.all.main;
								}
								if(data.successMessages.all.extended) {
									extendedMessage = data.successMessages.all.extended;
								}
						
							}
							
							if(data.successMessages[platform]) {
								//Any platform specific message? This will overwrite the one for all platforms.
								if(data.successMessages[platform].main) {
									mainMessage = data.successMessages[platform].main;
								}
								if(data.successMessages[platform].extended) {
									extendedMessage = data.successMessages[platform].extended;
								}
							
							}
						}
						
						//If there were any warning messages, these get added into a warning html box
						if(commandMessage != "") {
							mainMessage = mainMessage + "<div style='padding-top:20px;'><div  class='panel panel-warning'><div class='panel-heading'>Warning</div><div class='panel-body'>" + commandMessage + "</div></div></div>";
						}
					
						//Now we can attempt to clean up.
						removeOldTemp(opts, function(err) {
							
						
						
							if(err) {
								//Could leave a warning
								console.log("The installation was completed successfully, but the cleanup was not. ");
								console.log("reloadConfig:true");
								console.log("returnParams:?FINISHED=true&TABSTART=install-addon-tab&MSG=" + mainMessage + " Warning: the cleanup was not finished.&EXTENDED=You should check your add-ons folder and remove the " + tempDir + " folder manually. " + extendedMessage);
								process.exit(0);
							} else {
								
								
								
							
								console.log(mainMessage);
								console.log("reloadConfig:true");
								console.log("returnParams:?FINISHED=true&TABSTART=install-addon-tab&MSG=" + mainMessage + "&EXTENDED=" + extendedMessage);
								process.exit(0);
								
							}
						
						})
						
					}
				});
						
			} else {
				console.log("Warning: no valid install commands.");
				console.log("returnParams:?FINISHED=false&TABSTART=install-addon-tab&MSG=No valid install commands.");
				process.exit(0);
			
			}
		} else {
			console.log("Warning: no valid JSON data found");
			console.log("returnParams:?FINISHED=false&TABSTART=install-addon-tab&MSG=No valid JSON data found.");
			process.exit(0);
		}
	} else {
		console.log("Warning: no installer script was found");
		console.log("returnParams:?FINISHED=false&TABSTART=install-addon-tab&MSG=No installer script was found.");
		process.exit(0);
	}
	

}
		




function renameFolder(filename, dirname, opts) {
	//Input will be 'wound-0.7.3.zip'
	//We want to convert '../wound-0.7.3' folder to '../wound' folder
	//Trim up to 1st digit, or dot '.'. Then trim '-' chars at the end.
	
	var nozipFilename = filename.replace(/.zip/i, "");
	
	var dirIn = normalizeInclWinNetworks(targetAddonsFolder + tempDir);
	if(dirname) {
		dirIn = normalizeInclWinNetworks(targetAddonsFolder + tempDir + "/" + noTrailSlash(dirname));
	}
	
	//Read in the json descriptor to get an output folder name of the addon
	var desc = normalizeInclWinNetworks(dirIn + "/" + descriptorFile);
	console.log("Checking for file:" + desc);
	var dirOut = "";
	if(fs.existsSync(desc) == true) {
		try {
			var data = fsExtra.readJsonSync(desc);
			if(data) {
				dirOut = normalizeInclWinNetworks(targetAddonsFolder + data.name);
			}
		} catch(err) {
			console.log("Error: there was a problem in the medimage-installer .json file.");
			console.log("returnParams:?FINISHED=false&TABSTART=install-addon-tab&MSG=There was a problem in the medimage-installer .json file.&EXTENDED=" + err);
			process.exit(0);
		
		}
	}
	
	if(dirOut == "") {
		console.log("Using filename to determine directory...");
		//We will need to determine out own version based on the filename
	
		var dirOut = filename.replace(/[0-9\.]+/g, "");
		dirOut = dirOut.replace(/zip/i, "");
		dirOut = targetAddonsFolder + dirOut.replace(/-$/, '');
	}

	dirIn = normalizeInclWinNetworks(dirIn);
	dirOut = normalizeInclWinNetworks(dirOut);
	console.log("Dir in=" + dirIn + "\nDir out=" + dirOut);
	//fsExtra.move(dirIn, dirOut);
	
		fsExtra.move(dirIn, dirOut, { overwrite: true }, function(err) { 	//overwrite: true
		  if (err) {
			return console.log("returnParams:?FINISHED=false&TABSTART=install-addon-tab&MSG=Could not rename the folder.&EXTENDED=" + err);
		  } else {
			console.log('Success renaming!');
			openAndRunDescriptor(dirOut, opts);
			return;
		  }
		});
		
}

function uninstall(addonName, opts)
{
	var dirOut = normalizeInclWinNetworks(targetAddonsFolder + addonName);	//Absolute path to folder to delete
	
	//Change into the directory of the add-on
	try {
		process.chdir(dirOut);
	} catch(err) {
		return console.log("returnParams:?FINISHED=false&TABSTART=install-addon-tab&MSG=This is not a directory.&EXTENDED=" + err);
		process.exit(0);
	}

	
	//Read in the json descriptor to get
	var desc = dirOut + "/" + descriptorFile;
	console.log("Checking for file:" + desc);
	
	
	
	if(fs.existsSync(desc) == true) {
		try {
			var data = fsExtra.readJsonSync(desc);
		} catch(err) {
			console.log("Error: there was a problem in the medimage-installer .json file. " + err);
			console.log("returnParams:?FINISHED=false&TABSTART=install-addon-tab&MSG=There was a problem in the medimage-installer .json file.&EXTENDED=" + err);
			process.exit(0);
		
		}
		
		
		if(data) {
			//Yes there is an uninstaller script to run
			if(data.uninstallCommands) {
			
				//Determine our current platform
			
				var platform = getPlatform();
				async.waterfall([
					function(callback) {
						console.log("Checking all platform commands");
						if(data.uninstallCommands.all) {
							var prepend = "";
							if((platform == "unix")||(platform == "mac")) {
								if(opts.password != "") {
									prepend = "echo \"" + opts.password + "\" | sudo -S ";
								}
							}
							//Run through these commands always - all platforms	
							execCommands(data.uninstallCommands.all, prepend, function(err) {
								callback(err);
							});
						} else {
							callback(null);
						}
					},
					function(callback) {
						console.log("Checking Win32 commands");
						if((data.uninstallCommands.win32) && (platform == "win32")) {
							//Run through these commands win32
							execCommands(data.uninstallCommands.win32, "", function(err) {
								callback(err);
							});
						} else {
							callback(null);
						}
					},
					function(callback) {
						console.log("Checking Win64 commands");
						if((data.uninstallCommands.win64) && (platform == "win64")) {
							//Run through these commands win64
							execCommands(data.uninstallCommands.win64, "", function(err) {
								callback(err);
							});
						} else {
							callback(null);
						}
					},
					function(callback) {
						console.log("Checking Unix commands");
						if((data.uninstallCommands.unix) && (platform == "unix")) {
							//Run through these commands unix/linux	
							if(opts.password != "") {
								var prepend = "echo \"" + opts.password + "\" | sudo -S ";
							}
							execCommands(data.uninstallCommands.unix, prepend, function(err) {
								callback(err);
							});
						} else {
							callback(null);
						}
					},
					function(callback) {
						console.log("Checking Mac commands");
						if((data.uninstallCommands.mac) && (platform == "mac")) {
							//Run through these commands mac
							if(opts.password != "") {
								var prepend = "echo \"" + opts.password + "\" | sudo -S ";
							}
							execCommands(data.uninstallCommands.mac, prepend, function(err) {
								callback(err, 'done');
							});
						} else {
							callback(null);
						}
					}
				], 
				function (err, success) {
					// result now equals 'done'
					if(err) {
						console.log("The uninstallation was not complete.");
						console.log("returnParams:?FINISHED=false&TABSTART=install-addon-tab&MSG=The uninstallation was not complete.&EXTENDED=" + err);
						process.exit(0);
					} else {
					
						//Change back out of our folder
						process.chdir(targetAddonsFolder);
					
						//Now clear out the folder
						console.log("Removing folder:" + dirOut);
						if(((platform == "unix")||(platform == "mac"))&&(opts.password != "")) {
							var rmrf = [ "echo \"" + opts.password + "\" | sudo -S rm -rf " + dirOut ];		//Do an OS level sudo rm dir
							execCommands(rmrf, "", function(err) {
								if(err) {
									console.log("The uninstallation was not complete.");
									console.log("returnParams:?FINISHED=false&TABSTART=install-addon-tab&MSG=The uninstallation was not complete.&EXTENDED=" + err);
								} else {
									console.log("The uninstallation was completed successfully!");
									console.log("reloadConfig:true");
									console.log("returnParams:?FINISHED=true&TABSTART=install-addon-tab&MSG=The uninstallation was completed successfully!");
								}
								process.exit(0);
							});
						} else {
							
							fsExtra.remove(dirOut, function(err) {
								if(err) {
									console.log("The uninstallation was not complete.");
									console.log("returnParams:?FINISHED=false&TABSTART=install-addon-tab&MSG=The uninstallation was not complete.&EXTENDED=" + err);
								
								} else {
									console.log("The uninstallation was completed successfully!");
									console.log("reloadConfig:true");
									console.log("returnParams:?FINISHED=true&TABSTART=install-addon-tab&MSG=The uninstallation was completed successfully!");
								
								
								}
								process.exit(0);
							
							});
					
							
							
						}
					}
				});
			
			}
		} else {
			console.log("Warning: no valid JSON data found");
			console.log("returnParams:?FINISHED=false&TABSTART=install-addon-tab&MSG=Warning: no valid JSON datafound");
			process.exit(0);
		}
	} else {
		console.log("Warning: no valid JSON data found");
		console.log("returnParams:?FINISHED=false&TABSTART=install-addon-tab&MSG=Warning: no valid JSON data found");
		process.exit(0);
	}

		


}


function removeOldTemp(opts, cb)
{
	//Remove the old temporary installer folder
	//Change back out of our folder
	var platform = getPlatform();
	
	process.chdir(targetAddonsFolder);
	var dirOut = targetAddonsFolder + tempDir;	
	
	if(((platform == "unix")||(platform == "mac"))&&(opts.password != "")) {
		var rmrf = [ "echo \"" + opts.password + "\" | sudo -S rm -rf " + dirOut ];		//Do an OS level sudo rm dir
		execCommands(rmrf, "", function(err) {
			if(err) {
				console.log("The installation was not complete.");
				console.log("returnParams:?FINISHED=false&TABSTART=install-addon-tab&MSG=The installation was not complete. The old temporary folder could not be removed.&EXTENDED=" + err);
				process.exit(0);
			} else {
				cb(null);
			}
		});
	} else {
		
		fsExtra.remove(dirOut, function(err) {
			if(err) {
				console.log("The installation was not complete.");
				console.log("returnParams:?FINISHED=false&TABSTART=install-addon-tab&MSG=The installation was not complete. The old temporary folder could not be removed.&EXTENDED=" + err);
				process.exit(0);
			
			} else {
				cb(null);
			}
		});
		
	}

}




havePermission(configFile, function(err, ret) {

	if(err) {
		console.log("returnParams:?FINISHED=false&MSG=Sorry you do not have permissions to install add-ons. Please contact your administrator.");
	
	} else {

		if(ret == true) {
			//Yes we have permission to install
			if(process.argv[2]) {

			  var opts = queryString.parse(decodeURIComponent(process.argv[2]));

			  if((opts.zipfileURL)&&(opts.zipfileURL != "")) {
				  //If passing in a zip file url to install
				  var zipfileURL = opts.zipfileURL;
  
  
  
				  var parsed = url.parse(zipfileURL);
				  var filename = path.basename(parsed.pathname);
  
				  console.log("Filename: " + filename + " URL: " + zipfileURL);
				  //Get the filename of the path to the URL
  					
  				  try {
					  removeOldTemp(opts, function() {	
  
						  downloadAndUnzip(filename, zipfileURL, opts, function(err, dirname) {
							  console.log("Files unzipped");
  								
							  renameFolder(filename, dirname, opts);

						  });
					   });
				  } catch(err) {
				  	 	console.log("returnParams:?FINISHED=false&MSG=The installation was not complete.&EXTENDED=" + err);
				  	 	process.exit(0);
				  
				  }
			  } 
		  
			  if(opts.uninstall) {
				  try {
				  	uninstall(opts.uninstall, opts);
				  } catch(err) {
				  		console.log("returnParams:?FINISHED=false&MSG=The installation was not complete.&EXTENDED=" + err);
				  	 	process.exit(0);
				  
				  }		  
			  }
			  
			  if((!opts.uninstall)&&(!opts.zipfileURL)) {
			  	  console.log("You should enter a 'zipfileURL' or 'uninstall' param.");
			  	  console.log("returnParams:?FINISHED=false&MSG=Sorry, we don't seem to have an Add-on requested.");
				  process.exit(0);
			  }
  

  
			} else {
			  console.log("Usage: node install-addon.js zipfileURL%3Dhttp://url.To.Zip/file/name.zip (with urlencoded URL)");
  
			}
		} else {
			//No permission, sorry
			console.log("returnParams:?FINISHED=false&MSG=Sorry, you don't have permission to install or uninstall add-ons. Please check your config.json.");
		}
	}
});
