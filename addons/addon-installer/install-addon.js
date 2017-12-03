/*

Unzips, and then runs each of the commands in a 


*/




var url = require("url");
var path = require("path");
var AdmZip = require('adm-zip');
var path = require("path");
var upath = require("upath");
var queryString = require('querystring');
var http = require('http');
var https = require('https');
var fs = require('fs');
var fsExtra = require('fs-extra');
var async = require('async');
var exec = require('child_process').exec;



var httpsFlag = false;				//whether we are serving up https (= true) or http (= false)
var serverOptions = {};				//default https server options (see nodejs https module)
var verbose = false;



var targetAddonsFolder = __dirname + "/../";
var descriptorFile = "medimage-installer.json";


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

//With thanks from http://rajiev.com/download-an-extract-a-zip-file-with-node-js/
function downloadAndUnzip(filename, url, cb) {
	var tmpFilePath = targetAddonsFolder + filename;
	
	if(url.startsWith("https")) {
		//https
		https.get(url, function(response) {
			response.on('data', function (data) {
				fs.appendFileSync(tmpFilePath, data);
			});
		
			//TODO: handle error case
		
			response.on('end', function() {
				 var zip = new AdmZip(tmpFilePath);
				 
				 var zip = new AdmZip(tmpFilePath);
				 var zipEntries = zip.getEntries(); // an array of ZipEntry records 
 				  
 				 if(zipEntries[0].isDirectory == true) {
 				 	var dirName = zipEntries[0].entryName;	//e.g. "medimage-addon-p4m-0.0.1/"
 				 
 				 } else {
 				 	var dirName = null;
 				 }				 
				 
				 zip.extractAllTo(targetAddonsFolder, true);	//Overwrite is the 'true'
				 fs.unlink(tmpFilePath, cb);		//Remove the zip file itself
			})
		});
	
	
	} else {
		//http
		http.get(url, function(response) {
			response.on('data', function (data) {
				fs.appendFileSync(tmpFilePath, data);
			});
		
			//TODO: handle error case
		
			response.on('end', function() {
				 var zip = new AdmZip(tmpFilePath);
				 var zipEntries = zip.getEntries(); // an array of ZipEntry records 
 				  
 				 if(zipEntries[0].isDirectory == true) {
 				 	var dirName = zipEntries[0].entryName;	//e.g. "medimage-addon-p4m-0.0.1/"
 				 
 				 } else {
 				 	var dirName = null;
 				 }
 			 
				 zip.extractAllTo(targetAddonsFolder, true);	//Overwrite is the 'true'
				 fs.unlink(tmpFilePath, cb(null, dirName));		//Remove the zip file itself
			})
		});
	}
}


function execCommands(commandArray) 
{
		//Asyncronously call each item, but in sequential order. This means the process could
		//be doing something processor intensive without holding up the main server, but still allow
		//each add-on to potentially process sequentially. 
		
		
		async.eachOf(commandArray,
					// 2nd param is the function that each item is passed to
					function(runBlock, cnt, callback){
				
						console.log("Running command: " + commandArray[cnt]);
						exec(commandArray[cnt], {
								maxBuffer: 2000 * 1024 //max buffer size
							}, (err, stdout, stderr) => {
								 if (err) {
									// node couldn't execute the command
									console.log("There was a problem running the command. Error:" + err);
									callback(err);
							
								 } else {
					  
									  console.log("Stdout from command:" + stdout);
								 }
						 });	//End of exec
					
					  },	//End of async eachOf single item
					  function(err){
						// All tasks are done now
						if(err) {
						   console.log('returnParams:?MESSAGE=ERROR:' + err);
						 } else {
						   console.log('Completed all commands!');
						   
						   console.log("returnParams:?MESSAGE=Success");					   
						   return;
						 }
					   }
		); //End of async eachOf all items


}



function openAndRunDescriptor(directory)
{

	//Change into the directory of the add-on
	process.chdir(directory);
	
	var desc = directory + "/" + descriptorFile;
	console.log("Checking installer file " + desc);
	
	if(fs.existsSync(desc) == true) {
		const data = fsExtra.readJsonSync(desc);
		if(data) {
			//Yes there is an installer script to run
			if(data.installCommands) {
			
				//Determine our current platform
			
				if(data.installCommands.all) {
					//Run through these commands always - all platforms	
					execCommands(data.installCommands.all);
				}
			
				var platform = getPlatform();
				if((data.installCommands.win32) && (platform == "win32")) {
					//Only run these on Windows
					execCommands(data.installCommands.win32);
				}
			
				if((data.installCommands.unix) && (platform == "unix")) {
					//Only run these on Linux/unix
					execCommands(data.installCommands.unix);
				}
			
				if((data.installCommands.mac) && (platform == "mac")) {
					//Only run these on Macs
					execCommands(data.installCommands.mac);
				}
			
			}
		} else {
			console.log("Warning: no valid JSON data found");
		}
	} else {
		console.log("Warning: no installer script was found");
	}
	

}
		

function renameFolder(filename, dirname) {
	//Input will be 'wound-0.7.3.zip'
	//We want to convert '../wound-0.7.3' folder to '../wound' folder
	//Trim up to 1st digit, or dot '.'. Then trim '-' chars at the end.
	
	var dirIn = targetAddonsFolder + filename.replace(/.zip/i, "");
	if(dirname) {
		dirIn = targetAddonsFolder + noTrailSlash(dirname);
	}
	
	//Read in the json descriptor to get an output folder name of the addon
	var desc = dirIn + "/" + descriptorFile;
	console.log("Checking for file:" + desc);
	var dirOut = "";
	if(fs.existsSync(desc) == true) {
		const data = fsExtra.readJsonSync(desc);
		if(data) {
			dirOut = targetAddonsFolder + data.name;
		}
	}
	
	if(dirOut == "") {
		console.log("Using filename to determine directory...");
		//We will need to determine out own version based on the filename
	
		var dirOut = filename.replace(/[0-9\.]+/g, "");
		dirOut = dirOut.replace(/zip/i, "");
		dirOut = targetAddonsFolder + dirOut.replace(/-$/, '');
	}

	
	console.log("Dir in=" + dirIn + "\nDir out" + dirOut);
	//fsExtra.move(dirIn, dirOut);
	fsExtra.move(dirIn, dirOut, { overwrite: true }, function(err) {
	  if (err) {
	  	return console.error(err);
	  } else {
	  	console.log('Success renaming!');
	  	openAndRunDescriptor(dirOut);
	  	return;
	  }
	})
}




if(process.argv[2]) {

  var opts = queryString.parse(decodeURIComponent(process.argv[2]));
  var zipfileURL = opts.zipfileURL;
  
  var parsed = url.parse(zipfileURL);
  var filename = path.basename(parsed.pathname);
  
  console.log("Filename: " + filename + " URL: " + zipfileURL);
  //Get the filename of the path to the URL
  
  downloadAndUnzip(filename, zipfileURL, function(err, dirname) {
  	  console.log("Files unzipped");
  	  
  	  renameFolder(filename, dirname);
  
  });
  

  
} else {
  console.log("Usage: node install-addon.js http://url.To.Zip/file/name.zip");
  
}
