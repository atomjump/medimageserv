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
require("date-format-lite");
var mv = require('mv');
var fs = require('fs');
var exec = require('child_process').exec;
var drivelist = require('drivelist');
var uuid = require('node-uuid');
var fsExtra = require('fs-extra');
var request = require("request");
var needle = require('needle');
var readChunk = require('read-chunk'); // npm install read-chunk 
var imageType = require('image-type');
var shredfile = require('shredfile')();


var verbose = false;		//Set to true to display debug info
var outdirDefaultParent = '/medimage';		//These should have a slash before, and no slash after.
var outdirPhotos = '/photos';			//These should have a slash before, and no slash after.
var defaultTitle = "image";
var currentDisks = [];
var configFile = '/../config.json';
var newConfigFile = '/../newconfig.json';	//This is for a new install generally - it will auto-create from this file
						//if the config doesn't yet exist
var noFurtherFiles = "none";			//This gets piped out if there are no further files in directory
var pairingURL = "https://atomjump.com/med-genid.php";
var listenPort = 5566;
var remoteReadTimer = null;
var globalId = "";
var httpsFlag = false;				//whether we are serving up https (= true) or http (= false)
var serverOptions = {};				//default https server options (see nodejs https module)
var bytesTransferred = 0;
var noWin = false;					//By default we are on Windows
var maxUploadSize = 10485760;		//In bytes, max allowed = 10MB
var readingRemoteServer = false;		//We have started reading the remote server



//Check any command-line options
if((process.argv[2]) && (process.argv[2] == '-verbose')){
	verbose = true;
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
	var curdir = path.normalize(__dirname + "/..");
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



function checkConfigCurrent(setProxy, cb) {
	//Reads and updates config to get any new hard-drives added to the system, or a GUID added
	//setProxy is optional, otherwise set it to null
	//Returns cb(err) where err = null, or a string with the error


	//Write to a json file with the current drive.  This can be removed later manually by user, or added to
	fs.readFile(__dirname + configFile, function read(err, data) {
		if (err) {
			
			//Copy newconfig.json into config.json - it is likely a file that doesn't yet exist
			//Check file exists
			fs.stat(__dirname + configFile, function(ferr, stat) {
				    if(ferr == null) {
				    	//File exists, perhaps a file permissions issue.
			        	cb("Sorry, cannot read the config file! Please check your file permissions. " + ferr);
				    } else if(ferr.code == 'ENOENT') {
				        // file does not exist. Copy across a new version of newconfig.json to config.json
				        // and re-run
				        
				        
				        
				        fsExtra.copy(__dirname + newConfigFile, __dirname + configFile, function (err) {
					  if (err) {
					  	return console.error(err)
					  } else {
					  	//Success - try reading again
					  	
					  	
					  	
					  	checkConfigCurrent(setProxy, cb);
					  	return;
					  }
					}) // copies file 
				    } else {
				    	//Some other error. Perhaps a permissions problem
					cb("Sorry, cannot read the config file! Please check your file permissions. " + ferr);
				    }
			});
			
		
		} else {
			var content = JSON.parse(data);

			if(!content.globalId) {
				//Only need to create the server's ID once. And make sure it is not the same as the developer's ID
				//Old style:content.globalId = uuid.v4();
				//Now we assume a blank guid to begin with.
		 	}


			 if(setProxy) {
			   content.readProxy = setProxy;
			 }
	
			 if(globalId) {
			   content.globalId = globalId;
			 }
	
			 if(content.globalId) {
			    globalId = content.globalId;
			 }
	
			 if(content.listenPort) {
			   listenPort = content.listenPort;
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
			 
			 if(bytesTransferred != 0) {
			 	//Keep this up-to-date as we download
			 	content.transfer = bytesTransferred;
			 } else {
			 	if(content.transfer) {
			 		//Just starting server = get bytes from transfer
			 		bytesTransferred = content.transfer;
			 	}
			 	
			 }

			//Get the current drives
			drivelist.list(function(error, disks) {
				if (error) throw error;

				for(var cnt=0; cnt< disks.length; cnt++) {
					//On each drive, create a backup standard directory for photos
					if(verbose == true) console.log("Drive detected:" + JSON.stringify(disks[cnt]));
					var drive = disks[cnt].mountpoint;

					if(drive) {

					    if(serverParentDir().indexOf(drive) < 0) {
						    //Drive is not included in this server parent dir, therefore talking about a different drive

						    //Create the dir
						    if (!fs.existsSync(path.normalize(drive + outdirDefaultParent))){
							    fs.mkdirSync(path.normalize(drive + outdirDefaultParent));
						    }

						    if (!fs.existsSync(path.normalize(drive + outdirDefaultParent + outdirPhotos))){
							    fs.mkdirSync(path.normalize(drive + outdirDefaultParent + outdirPhotos));
						    }

						    //Append to the file's array if user has configured it as such
						    if(content.onStartBackupDriveDetect == true) {
						    	content.backupTo = pushIfNew(content.backupTo, drive + outdirDefaultParent + outdirPhotos);
						    }
					    }
					}
				}

				//Write the file nicely formatted again
				fs.writeFile(__dirname + configFile, JSON.stringify(content, null, 6), function(err) {
					if(err) {
						cb(err);
					}

					if(verbose == true) console.log("The config file was saved!");

					//Now start any ping to read from a remote server
					if((content.readProxy) && (content.readProxy != "")) {
						startReadRemoteServer(content.readProxy);

					}
					cb(null);
				});

			 });


		};
	});

}


function fileWalk(startDir, cb)
{
   //Read and return the first file in dir, and the count of which file it is. Only the cnt = 0 is used
   var items = [];
   if(verbose == true) console.log("Searching:" + startDir);

   if (fsExtra.existsSync(path.normalize(startDir))){
       try {
           var walk = fsExtra.walk(startDir);

	        walk.on('data', function (item) {
	                	if(verbose == true) console.log("Found:" + item.path);
			        items.push(item.path);
		          })
		          .on('end', function () {
			        for(var cnt = 0; cnt< items.length; cnt++) {
				         if(items[cnt].indexOf(".jpg") >= 0) {
					        cb(items[cnt]);
				         	return;
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
	request.head(uri, function(err, res, body){
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


				var createFile = path.normalize(trailSlash(serverParentDir()) + trailSlash(outdirPhotos) + dirFile);


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


								var stream = request(uri);
								var alreadyClosed = false;
								stream.pipe(fs.createWriteStream(createFile)
												.on('error', function(err) {
													console.log("Error writing to file");
													callback(error);
												})
											)
								.on('close', function() {

									console.log("Downloaded successfully!" + createFile);
									if(alreadyClosed == false) {
										alreadyClosed = true;

										//Update the data transferred successfully
										if(uri.indexOf("atomjump.com") >= 0) {
											var stats = fs.statSync(createFile);
											var fileSizeInBytes = stats["size"];

											bytesTransferred += fileSizeInBytes;

											//Save the bytes transferred to atomjump.com for progress
											checkConfigCurrent(null, function() {

											})
										}

																		//Backup the file
										backupFile(createFile, "", dirFile);




										callback(null);
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
	if(readingRemoteServer == false) {
		readingRemoteServer = true;
		readRemoteServer(url);
	} else {
			//Double reading - do nothing
			//console.log("Warning: double reading");
	}
}

function readRemoteServer(url)
{
	//Every 5 seconds, read the remote server in the config file, and download images to our server.
	//But pause while each request is coming in until fully downloaded.

		var _url = url;
		setTimeout(function() {
			process.stdout.write("'");     //Display movement to show upload pinging
			download(url, function(){
				  readRemoteServer(_url);
			});

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




function backupFile(thisPath, outhashdir, finalFileName)
{


	//Read in the config file
	fs.readFile(__dirname + configFile, function read(err, data) {
		if (err) {
			console.log("Warning: Error reading config file for backup options: " + err);
		} else {
			var content = JSON.parse(data);

			//Loop through all the backup directories
			for(var cnt=0; cnt< content.backupTo.length; cnt++) {

				if(outhashdir) {
					var target = trailSlash(content.backupTo[cnt]) + trailSlash(outhashdir) + finalFileName;
			    	} else {
					var target = trailSlash(content.backupTo[cnt]) + finalFileName;
				}
				if(verbose == true) console.log("Backing up " + thisPath + " to:" + target);

				fsExtra.ensureDir(trailSlash(content.backupTo[cnt]) + trailSlash(outhashdir), function(err) {
					if(err) {
						console.log("Warning: Could not create directory for backup: " + content.backupTo[cnt]);
					} else {
						try {
							console.log("Copying " + thisPath + " to " + target);
							fsExtra.copySync(thisPath, target);
							ensurePhotoReadableWindows(target);
						} catch (err) {
							console.error('Warning: there was a problem backing up: ' + err.message);
						}
					}
				});

			}
		}

	});
}


function trimChar(string, charToRemove) {
    while(string.substring(0,1)==charToRemove) {
        string = string.substring(1);
    }

    while(string.substring(string.length, -1)==charToRemove) {
        string = string.substring(0,string.length-1);
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
	if(httpsFlag == true) {
		console.log("Starting https server.");
		https.createServer(options, handleServer).listen(listenPort);
		
		
	} else {
		console.log("Starting http server.");
		http.createServer(handleServer).listen(listenPort);
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
			        
        			res.writeHead(400, {'content-type': 'text/plain'});
        			res.end("Invalid request: " + err.message);
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
					var imageObj = imageType(buffer);	//Display the file type
					if(imageObj.mime != 'image/jpeg') {
						//No file exists
						console.log("Error uploading file. Only jpg image files are allowed.");
			        	res.statusCode = 400;			//Error during transmission - tell the app about it
	  					res.end();
						return;
					}
					
					
					
					
					
					var title = files.file1[0].originalFilename;
	
					res.writeHead(200, {'content-type': 'text/plain'});
				  	res.write('Received upload successfully! Check ' + path.normalize(parentDir + outdirPhotos) + ' for your image.\n\n');
				  	res.end();
	
	
					//Copy file to eg. c:/snapvolt/photos
					var outFile = title;
					outFile = outFile.replace('.jpg','');			//Remove jpg from filename
					outFile = outFile.replace('.jpeg','');			//Remove jpg from filename
					outFile = replaceAll(outFile, "..", "");			//Remove nasty chars
					
					
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
	
					//Check the directory exists, and create
					
					if (!fs.existsSync(path.normalize(parentDir + outdirPhotos))){
				   		if(verbose == true) console.log('Creating dir:' + path.normalize(parentDir + outdirPhotos));
	
	   					fsExtra.mkdirsSync(path.normalize(parentDir + outdirPhotos));
				  		if(verbose == true) console.log('Created OK dir:' + path.normalize(parentDir + outdirPhotos));
	
					}
	
					//Create the final hash outdir
					outdir = parentDir + outdirPhotos + outhashdir;
					if (!fs.existsSync(path.normalize(outdir))){
						if(verbose == true) console.log('Creating dir:' + path.normalize(outdir));
						fsExtra.mkdirsSync(path.normalize(outdir));
						if(verbose == true) console.log('Created OK');
	
					}
	
	
	
					finalFileName = finalFileName + '.jpg';
	
					//Move the file into the standard location of this server
					var fullPath = outdir + '/' + finalFileName;
					if(verbose == true) console.log("Moving " + files.file1[0].path + " to " + fullPath);
					mv(files.file1[0].path, fullPath, {mkdirp: true},  function(err) { //path.normalize(
						  // done. it tried fs.rename first, and then falls back to
						  // piping the source file to the dest file and then unlinking
						  // the source file.
						  if(err) {
							console.log(err);
	
						  } else {
							console.log('\n' + finalFileName + ' file uploaded');
	
							//Ensure no admin restictions on Windows
							ensurePhotoReadableWindows(fullPath);
	
							//Now copy to any other backup directories
							if(verbose == true) console.log("Backups:");
							var thisPath = fullPath;
	
							//Now backup to any directories specified in the config
							backupFile(thisPath, outhashdir, finalFileName);
	
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
			body.push(chunk);
		});
	
		req.on('end', function() {
	
	
			//A get request to pull from the server
			// show a file upload form
			var url = req.url;
			if((url == '/') || (url == "")) {
				  url = "/index.html";
				  
				  //The homepage has a custom string of the number of bytes transferred
				  var formattedBytes = formatBytes(bytesTransferred, 1);
				  var customString = { "CUSTOMSTRING": formattedBytes };
				  
			} else {
			  	//Mainly we don't have any custom strings
			  	customString = "";
			}
	
			var removeAfterwards = false;
			var read = '/read/';
			var pair = '/pair';
	
			if(verbose == true) console.log("Url requested:" + url);
	
			if(url.substr(0,pair.length) == pair) {
				   //Do a get request from the known aj server
				   //for a new pairing guid
				   var fullPairingUrl = pairingURL;
	
				   var queryString = url.substr(pair.length);
				   
				   
				   checkConfigCurrent(null, function() {
					   if(globalId != "") {
					   	//We already know the global id - use it to update the passcode only
					   	if(queryString) {
					   		queryString = queryString + "&guid=" + globalId;
						} else {
							queryString = "?guid=" + globalId;
						}
					   }
		
					   if(queryString) {
						   fullPairingUrl = fullPairingUrl + queryString;
		
					   }
					   console.log("Request for pairing:" + fullPairingUrl);
		
					   needle.get(fullPairingUrl, function(error, response) {
						  if (!error && response.statusCode == 200) {
							  console.log(response.body);
		
							   var codes = response.body.split(" ");
							   var passcode = codes[0];
							   globalId = codes[1];
							   var guid = globalId;
							   var proxyServer = codes[2].replace("\n", "");
							   if(codes[3]) {
							   	var country = codes[3].replace("\n", "");
							   } else {
							   	//Defaults to an unknown country.
							   	var country = "[Unknown]";
							   }
							   var readProx = proxyServer + "/read/" + guid;
							   console.log("Proxy set to:" + readProx);
							   
							   var replace = {
							   	 "CUSTOMCODE": passcode,
							   	 "CUSTOMCOUNTRY": country
							   };
		
							   //Write full proxy to config file
							   checkConfigCurrent(readProx, function() {
		
		
								   //Display passcode to user
								   var outdir = __dirname + "/../public/passcode.html";
								   serveUpFile(outdir, null, res, false, replace);
								   return;
							   });
		
		
						  }
					   });
				   });
	
	
	   			} else {		//end of pair
	
	
				  if(url.substr(0,read.length) == read) {
					 //Get uploaded photos from coded subdir
					 var codeDir = url.substr(read.length);
					 var parentDir = serverParentDir();
					 if(verbose == true) console.log("This drive:" + parentDir);
					 if(verbose == true) console.log("Coded directory:" + codeDir);
	
					 if(codeDir.length <= 0) {
						 console.log("Cannot read without a directory");
						 return;
					 }
	
					 var outdir = path.normalize(parentDir + outdirPhotos + '/' + codeDir);
					 var compareWith = path.normalize(parentDir + outdirPhotos);
	
					 if(verbose == true) console.log("Output directory to scan " + outdir + ". Must include:" + compareWith);
					 //For security purposes the path must include the parentDir and outdiePhotos in a complete form
					 //ie. be subdirectories. Otherwise a ../../ would allow deletion of an internal file
					 if(outdir.indexOf(compareWith) > -1) {
	
	
						 //Get first file in the directory list
						 fileWalk(outdir, function(outfile, cnt) {
	
							 if(outfile) {
								//Get outfile - compareWith
								var localFileName = outfile.replace(compareWith, "");
								if(verbose == true) console.log("Local file to download via proxy as:" + localFileName);
								if(verbose == true) console.log("About to download (eventually delete): " + outfile);
								
								if(req.method === "HEAD") {
									//Get the header only
									res.writeHead(200, {'content-type': "image/jpg", 'file-name': localFileName });
									res.end();
									
								} else {
									//Now get the full file
									serveUpFile(outfile,localFileName, res, true);
								}
								
							 } else {
								//Reply with a 'no further files' simple text response to client
	
								if(verbose == true) {
									console.log("No images");
								} else {
									process.stdout.write(".");
								}
								res.writeHead(200, {'content-type': 'text/html'});
								res.end(noFurtherFiles);
								return;
	
							 }
						 });
					 } else {		//end of outdir compare
						console.log("Security exception detected in " + outdir);
						return;
					 }
	
				   } else {  //end of url read
						//Get a front-end facing image or html file
						var outdir = __dirname + "/../public" + url;
						
						
						serveUpFile(outdir, null, res, false, customString);
				   }
		  	} //end of check for pairing
			
		}); //Request end end
	}	//end of ordinary file processing
}


function serveUpFile(fullFile, theFile, res, deleteAfterwards, customStringList) {

  //CustomStringList should be in format:
  //  {
  //     "STRINGTOREPLACE1": withValue1,
  //     "STRINGTOREPLACE2": withValue2
  //  }
  }
  var normpath = path.normalize(fullFile);

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
  }
  if (ext === '.jpg') {
	 contentType = 'image/jpg';
  }
  
  if(ext === '.svg') {
  	contentType = 'image/svg+xml';
  	stream = false;		//for some reason svg doesn't like being streamed
  }

  if(ext === '.css') {
    contentType = 'text/css';
  }

  //Being preparation to send
 
  
  if(stream == false) {
	//Implies we need to modify this file, and it is likely and html request - i.e. fairly rare
  	//Use the slow method:
  	fs.readFile(normpath, function (err,data) {


	  if (err) {
	   	res.writeHead(404);
	   	res.end(JSON.stringify(err));
	   	return;
	  }


	 
	     //This is use for a replace on an HTML file with custom strings
	     var strData = data.toString();
	     
	     for (var key in customStringArray) {
	     	  strData = strData.replace(key, customStringArray[key]);
  		  if(verbose == true) console.log("key " + key + " has value " + customStringArray[key]);
  			
	     }
	     
	     
	     if(verbose == true) console.log(strData);
	
	     data = JSON.parse( JSON.stringify( strData ) ); //JSON.parse(strData);
	  

	  res.on('error', function(err){
	  	//Handle the errors here
	  	res.statusCode = 400;
    		res.end();
	  })

	  res.writeHead(200, {'content-type': contentType, 'file-name': theFile});  
	  
	  
	  res.end(data, function(err) {
		  //Wait until finished sending, then delete locally
		  if(err) {
	  	  	 console.log(err);
	  	  } else {
			//success, do nothing
			
	   	   }
  	   });
	 });  //End of readFile
   } else {	//End of if custom string

  		//Use streams instead for a larger file
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
				shredfile.shred(normpath, function(err, file) {
					if(err) {
						console.log(err);
						return;
					}
					console.log("Sent on and shredded " + theFile);
				});
					
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
