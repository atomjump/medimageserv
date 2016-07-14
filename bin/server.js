/*

MedImage Server - runs an http server allowing uploads of photos
and downloads from other MedImage Servers.

../config.json contains the settings for this server.

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


var outdirDefaultParent = '/medimage';
var outdirPhotos = '/photos';
var defaultTitle = "image";
var currentDisks = [];
var configFile = '/../config.json';
var noFurtherFiles = "none";			//This gets piped out if there are no further files in directory
var pairingURL = "https://atomjump.com/med-genid.php";
var listenPort = 5566;
var remoteReadTimer = null;
var globalId = "";
var httpsFlag = false;				//whether we are serving up https (= true) or http (= false)
var serverOptions = {};
/*
	requestCert : false,
	cipher:	[
	    "ECDHE-RSA-AES128-GCM-SHA256",	
	    "ECDHE-RSA-AES256-SHA384",
	    "DHE-RSA-AES256-SHA384",
	    "ECDHE-RSA-AES256-SHA256",
	    "DHE-RSA-AES256-SHA256",
	    "ECDHE-RSA-AES128-SHA256",
	    "DHE-RSA-AES128-SHA256",
	    "HIGH",
	    "!aNULL",
	    "!eNULL",
	    "!EXPORT",
	    "!DES",
	    "!RC4",
	    "!MD5",
	    "!PSK",
	    "!SRP",
	    "!CAMELLIA"
	].join(':')
	
};				//https server options
*/

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
	console.log(process.platform);
	var isWin = false;
	if(platform.indexOf("win") >= 0) {
	    isWin = true;
	}
	console.log("IsWin=" + isWin);
	if(isWin) {
		//See: http://serverfault.com/questions/335625/icacls-granting-access-to-all-users-on-windows-7
		//Grant all users access, rather than just admin
		var run = 'icacls ' + fullPath + ' /t /grant Everyone:(OI)(CI)F';
		console.log("Running:" + run);
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
	console.log(process.platform);
	var isWin = false;
	if(platform.indexOf("win") >= 0) {
	    isWin = true;
	}
	console.log("IsWin=" + isWin);
	if(isWin) {
		//See: http://serverfault.com/questions/335625/icacls-granting-access-to-all-users-on-windows-7
		//Grant all users access, rather than just admin
		var run = 'icacls ' + fullPath + ' /grant Everyone:(OI)(CI)F';
		console.log("Running:" + run);
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
			cb("Sorry, cannot read config file! " + err);
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
			 		console.log("https key:\n" + serverOptions.key);
			 	}
			 }
			 
			 if(content.httpsCert) {
			 	//httpsCert should point to the cert .pem file
			 	httpsFlag = true;
			 	if(!serverOptions.cert) {
			 		serverOptions.cert = fs.readFileSync(content.httpsCert);
			 		console.log("https cert:\n" + serverOptions.cert);
			 	}
			 	
			 }

			//Get the current drives
			drivelist.list(function(error, disks) {
				if (error) throw error;

				for(var cnt=0; cnt< disks.length; cnt++) {
					//On each drive, create a backup standard directory for photos
					console.log("Drive detected:" + JSON.stringify(disks[cnt]));
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

					console.log("The config file was saved!");

					//Now start any ping to read from a remote server
					if(content.readProxy) {
						readRemoteServer(content.readProxy);

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
   console.log("Searching:" + startDir);

   if (fsExtra.existsSync(path.normalize(startDir))){
       try {
           var walk = fsExtra.walk(startDir);

	        walk.on('data', function (item) {
	                console.log("Found:" + item.path);
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


function download(uri, callback){
  request.head(uri, function(err, res, body){
    if(err) {
		console.log("Error requesting from proxy:" + err);
	} else {
		console.log(JSON.stringify(res.headers));
    	console.log('content-type:', res.headers['content-type']);
    	console.log('content-length:', res.headers['content-length']);
    	console.log('file-name:', res.headers['file-name']);
        if(res.headers['file-name']) {

     	var dirFile = res.headers['file-name'];
     	dirFile = dirFile.replace(globalId + '/', ''); //remove our id


		    var createFile = path.normalize(serverParentDir() + outdirPhotos + dirFile);
		    if(createFile) {
		        console.log("Creating file:" + createFile);
		        var dirCreate = path.dirname(createFile);
		        console.log("Creating dir:" + dirCreate);
		        //Make sure directory
            		fsExtra.ensureDir(dirCreate, function(err) {
		            if(err) {
			            console.log("Warning: Could not create directory for: " + dirCreate);
		            } else {
		                console.log("Created dir:" + dirCreate);
		                ensureDirectoryWritableWindows(dirCreate, function(err) {

		                    if(err) {
		                        console.log("Error processing dir:" + err);
		                    } else {
		                        console.log("Directory processed");
		                        console.log("About to create local file " + createFile + " from uri:" + uri);
					
					
					request.get(uri)
					      .on('response', function (resp) {
					      		if (resp.statusCode == 200) {
					          		backupFile(createFile, "", dirFile);							
							}
						}) 
					      .pipe(fs.createWriteStream(createFile));

					/*
					//var file = fs.createWriteStream(createFile);

    					//TODO FIX THIS!
					needle.get(url, {parse_response: false}, function(err, resp) {
					    
					    if (!err) {
							//Now backup to any directories specified in the config
							//resp.body.pipe(file);
							file.write(resp.body);
							///resp.body.on('end', function() {
								//Now backup to any directories specified in the config
							file.end(function() {
								backupFile(createFile, "", dirFile);
							})
								
							//});
					    } else {
							//resp.body has file - pipe to file
							console.log("Error downloading."); //TODO better handling
					    }
					    
					  });
					  */
					
					/*needle.get(uri, { output: createFile }, function(err, resp, body) {
						if (!error && response.statusCode == 200) {
							//Now backup to any directories specified in the config
							backupFile(createFile, "", dirFile);
							
						} else {
							console.log("Error downloading file.");
							//TODO: handle this better here.
						}
					});*/
					/* old way:
		                        var file = fs.createWriteStream(createFile);
	                                if(uri.substr(0,5) == "https") {
	                                	console.log("Getting https.  Uri:" + uri);
	                                	//https version
	                                	var request = https.get(uri, function(response) {
		                                  	response.pipe(file);
		                                  	response.on('end', function() {
								//Now backup to any directories specified in the config
								backupFile(createFile, "", dirFile);
							});
	                                	});
	                                } else {
	                                	//http version
	                                	console.log("Getting http.  Uri:" + uri);
		                                var request = http.get(uri, function(response) {
		                                  	response.pipe(file);
		                                  	response.on('end', function() {
								//Now backup to any directories specified in the config
								backupFile(createFile, "", dirFile);
							});
	                                	});
	                                	
	                                }
	                                */


                            	   }




		                }); //end of directory writable

                    }
                }); //end of ensuredir exists
            } //end of if file exists
        } //end of if file-name exists
	} //end of no error from proxy
  }); //end of request head
}



function readRemoteServer(url)
{
	//Every 5 seconds, read the remote server in the config file, and download images to our server.
	if(remoteReadTimer) {
		clearInterval(remoteReadTimer);		//ensure a clear read
	}

	remoteReadTimer = setInterval(function() {
		download(url, function(){
			  console.log('done');
		});

	}, 5000);

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
					var target = content.backupTo[cnt] + '/' + outhashdir + '/' + finalFileName;
			    	} else {
					var target = content.backupTo[cnt] + finalFileName;
				}
				console.log("Backing up " + thisPath + " to:" + target);

				fsExtra.ensureDir(content.backupTo[cnt] + '/' + outhashdir, function(err) {
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


function httpHttpsCreateServer(options) {
	if(httpsFlag == true) {
		console.log("Starting https server.");
		https.createServer(options, handleServer).listen(listenPort);
		
		
	} else {
		console.log("Starting https server.");
		http.createServer(handleServer).listen(listenPort);
	}
	
}

function handleServer(req, res) {
	
	  if (req.url === '/api/photo' && req.method === 'POST') {
		// parse a file upload

		var form = new multiparty.Form();


		form.parse(req, function(err, fields, files) {
		   //Process filename of uploaded file, then move into the server's directory, and finally
		   //copy the files into any backup directories


			//The standard outdir is the drive from the current server script
			var parentDir = serverParentDir();
			console.log("This drive:" + parentDir);
			var outdir = parentDir + outdirPhotos;

   			console.log('Outdir:' + outdir);
			  res.writeHead(200, {'content-type': 'text/plain'});
			  res.write('Received upload successfully! Check ' + path.normalize(parentDir + outdirPhotos) + ' for your image.\n\n');
			  res.end();

   			console.log('Files ' + JSON.stringify(files, null, 4));
			//Use original filename for name
			if(files && files.file1 && files.file1[0]) {
				var title = files.file1[0].originalFilename;


				//Copy file to eg. c:/snapvolt/photos
				var outFile = title;
				outFile = outFile.replace('.jpg','');			//Remove jpg from filename
				outFile = outFile.replace('.jpeg','');			//Remove jpg from filename

				var words = outFile.split('-');

				var finalFileName = "";
				var outhashdir = "";
				//Array of distinct words
				for(var cnt = 0; cnt< words.length; cnt++) {
					if(words[cnt].charAt(0) == '#') {
						   var getDir = words[cnt].replace('#','');

						   console.log('Comparing ' + getDir + ' with ' + globalId);
						   if(getDir != globalId) {
						       outhashdir = outhashdir + '/' + getDir;
            						console.log('OutHashDir:' + outhashdir);
        					}
					} else {
						//Start building back filename with hyphens between words
						if(finalFileName.length > 0) {
							finalFileName = finalFileName + '-';
						}
						finalFileName = finalFileName + words[cnt];
					}
				}  //end of loop

				//Check the directory exists, and create
				if (!fs.existsSync(path.normalize(parentDir + outdirPhotos))){
						   		console.log('Creating dir:' + path.normalize(parentDir + outdirPhotos));

		   						fs.mkdirSync(path.normalize(parentDir + outdirPhotos));
						  			console.log('Created OK dir:' + path.normalize(parentDir + outdirPhotos));

				}

					//Create the final hash outdir
				 outdir = parentDir + outdirPhotos + outhashdir;
				if (!fs.existsSync(path.normalize(outdir))){
					console.log('Creating dir:' + path.normalize(outdir));
					fs.mkdirSync(path.normalize(outdir));
					console.log('Created OK');

				}



				finalFileName = finalFileName + '.jpg';

				//Move the file into the standard location of this server
				var fullPath = outdir + '/' + finalFileName;
				console.log("Moving " + files.file1[0].path + " to " + fullPath);
				mv(files.file1[0].path, fullPath, {mkdirp: true},  function(err) { //path.normalize(
					  // done. it tried fs.rename first, and then falls back to
					  // piping the source file to the dest file and then unlinking
					  // the source file.
					  if(err) {
						console.log(err);

					  } else {
						console.log(finalFileName + ' file uploaded');

						//Ensure no admin restictions on Windows
						ensurePhotoReadableWindows(fullPath);

						//Now copy to any other backup directories
						console.log("Backups:");
						var thisPath = fullPath;

						//Now backup to any directories specified in the config
						backupFile(thisPath, outhashdir, finalFileName);

					  }
				});
			}








		}); //End of form.parse

		return;

	  } else {  //end of api upload
		  //A get request to pull from the server
		  // show a file upload form
		  var url = req.url;
		  if((url == '/') || (url == "")) {
			  url = "/index.html";
		  }

		  var removeAfterwards = false;
		  var read = '/read/';
		  var pair = '/pair';

		   console.log("Url requested:" + url);

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
						   var readProx = proxyServer + "/read/" + guid;
						   console.log("Proxy set to:" + readProx);
	
	
						   //Write full proxy to config file
						   checkConfigCurrent(readProx, function() {
	
	
							   //Display passcode to user
								 var outdir = __dirname + "/../public/passcode.html";
											serveUpFile(outdir, null, res, false, passcode);
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
				 console.log("This drive:" + parentDir);
				 console.log("Coded directory:" + codeDir);

				 if(codeDir.length <= 0) {
					 console.log("Cannot read without a directory");
					 return;
				 }

				 var outdir = path.normalize(parentDir + outdirPhotos + '/' + codeDir);
				 var compareWith = path.normalize(parentDir + outdirPhotos);

				 console.log("Output directory to scan " + outdir + ". Must include:" + compareWith);
				 //For security purposes the path must include the parentDir and outdiePhotos in a complete form
				 //ie. be subdirectories. Otherwise a ../../ would allow deletion of an internal file
				 if(outdir.indexOf(compareWith) > -1) {


					 //Get first file in the directory list
					 fileWalk(outdir, function(outfile, cnt) {

						 if(outfile) {
							//Get outfile - compareWith
							var localFileName = outfile.replace(compareWith, "");
							console.log("Local file to download via proxy as:" + localFileName);
							console.log("About to download (eventually delete): " + outfile);

							serveUpFile(outfile,localFileName, res, true);
							
						 } else {
							//Reply with a 'no further files' simple text response to client

							console.log("No images");
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
						   serveUpFile(outdir, null, res, false);
			   }
	  		} //end of check for pairing
		} //end of get request
	
	
	
}


checkConfigCurrent(null, function(err) {

	if(err) {
		console.log("Error updating config.json: " + err);
		process.exit(0);
	}

	httpHttpsCreateServer(serverOptions);  //end of createServer
}); //end of checkConfigCurrent

function serveUpFile(fullFile, theFile, res, deleteAfterwards, customString) {

  var normpath = path.normalize(fullFile);

  console.log(normpath);


  // set the content type
  var ext = path.extname(normpath);
  var contentType = 'text/html';


  //Handle images
  if (ext === '.png') {
	 contentType = 'image/png';
  }
  if (ext === '.jpg') {
	 contentType = 'image/jpg';
  }

  if(ext === '.css') {
    contentType = 'text/css';
  }

  //Being preparation to send
  //Should this be here??: res.writeHead(200, {'content-type': contentType, 'file-name': normpath});

  //Read the file from disk, then send to client
  fs.readFile(normpath, function (err,data) {


	  if (err) {
	   	res.writeHead(404);
	   	res.end(JSON.stringify(err));
	   	return;
	  }


	  if(customString) {
	     //This is use for a replace on an HTML file with the passcode
	     var strData = data.toString();
	     strData = strData.replace("CUSTOMSTRING",customString);
	     console.log(strData);

	     data =JSON.parse( JSON.stringify( strData ) ); //JSON.parse(strData);
	  }

	  res.writeHead(200, {'content-type': contentType, 'file-name': theFile});
	  res.end(data, function(err) {
		  //Wait until finished sending, then delete locally
		  if(err) {
	  	  	 console.log(err);
	  	  } else {
			  if(deleteAfterwards == true) {
					//Delete the file 'normpath' from the server. This server is like a proxy cache and
					//doesn't hold permanently
					console.log("About to delete:" + normpath);
					fs.unlink(normpath, function() {
					   console.log("Deleted " + normpath + " successfully!");
					})
			  }
	   	   }
  	   });
  });



}
