<img src="http://medimage.co.nz/wp-content/uploads/2018/04/icon-60.png">

# MedImage Server

The MedImage Server is a companion product to the MedImage apps on smart-phones. See http://medimage.co.nz

The combined product enables the medical practitioner to take a photo of a patient with their mobile phone, and have the image transferred directly into a specific folder on their PC or server.  The image is tagged with a patient id immediately before the photo is taken.

The most common way to install this package is to use an internet connected PC as a 'proxy' (typically linux based), which temporarily holds the photos that are uploaded from the phone via 3G/4G to the server. A Windows Med Image reader sits on the Doctor's PC, which reads the proxy on a regular basis, and downloads images directly into a chosen folder (or folders) on the PC

## 1. To Install Your Proxy

This is useful when you cannot have a Wifi connection, and must go via a secure internet connection.

On a linux based server, first install NodeJS and npm.
See https://www.digitalocean.com/community/tutorials/how-to-install-node-js-on-an-ubuntu-14-04-server

Then:

```
eval "$(curl -fsSL -H 'Cache-Control: no-cache' https://git.atomjump.com/medimageserv-linstaller.git/install)"     
```

(Or for a super user installation, which is sometimes required) 

```
eval "$(curl -fsSL -H 'Cache-Control: no-cache' https://git.atomjump.com/medimageserv-linstaller.git/install-root)"     
```

Alternatively, if these do not match your server's permissions, you can find the list of individual commands at 
https://git.atomjump.com/medimageserv-linstaller.git/install
https://git.atomjump.com/medimageserv-linstaller.git/install-root

Run the command the last part of the script displays, to get autostart at boot-up.

You may have to open the firewall to port 5566 for reading and writing eg.:
```
sudo ufw allow 5566/tcp
```


To start MedImage server
```
pm2 start medimage-server
```

To stop MedImage server:
```
pm2 stop medimage-server
```

To restart (after any config.json changes):
```
pm2 restart medimage-server
```

For logging or and any permissions issues, see the section 'Troubleshooting' below.




Note: this proxy daemon is always on, but the images are only kept on this machine for a few seconds.



## 2. On your Windows PC/local server

Download and run the installable MedImageServer.exe from http://medimage.co.nz

If you have installed your own proxy using npm, above, enter the URL of your proxy server eg. 'https://myproxy.mycompany.com:5566' into the third large button. You will be given a 4 digit pairing code.



## 3. On your MedImage Android/iPhone app 

Search the Play Store or App store for 'MedImage'. Purchase and install.

Click the large blue/purple button on the app to connect and start taking photos. If you have no wifi connection it will ask you for your 4 character pairing code from your server.

Enter the patient id in the box at the top, specific to each photo. Note: #tags will allocate a directory (this will create another subdirectory inside your directory.). eg.
```
#elderly Fred
```
would create a directory called elderly/ on your PC and upload a file called 'Fred-[datetime]'



## Options

These are located in the file config.json.


* **backupTo** should be an array of linux-style paths where the files are backed up to.
* **readProxy** should be null if this is the master 'proxy' server, but will be set automatically after you sync.
* **listenPort** is the port on your server which is open to being read
* **httpsKey** is optional. If you are on an https server, it is required (an http server should leave this blank). It is a file path to the key .pem file which includes your private ssl key.
* **httpsCert** is optional. If you are on an https server, it is required (an http server should leave this blank). It is a file path to the certificate .pem file which includes your server's ssl certificate.
* **onStartBackupDriveDetect** is optional. If set to 'true' it autodetects new drives added when starting, and will backup your new photos to:
  New Drive:\MedImage\photos 
* **allowPhotosLeaving**  If set to 'true', this allows photos to leave the machine and be downloaded by other installations of the server. Leave 'true' for proxy servers, but false for client Windows machines.
* **allowGettingRemotePhotos**  If set to 'true', this allows photos to be downloaded from a remote proxy server. If this is a proxy server, this should be set to 'false', otherwise for client Windows machines, set to 'true'.
* **webProxy** If your web browser usually requires a proxy server (i.e. for normal web requests), then use the option"webProxy", in this format: "http://yourUser:yourPassword@webProxyIPaddress:webProxyPort"
* **lockDown** You can switch a server into 'lock down' mode, where the interface cannot change any settings, add-ons, or see any technical logs, by setting this to 'true'. Ver >= 1.3.6
* **basicAuthent** Enter a human readable password for addons that need some light security. This is a global password visible only within the config file (anyone with file level access to the server can see this). Ver >= 1.3.8
* **allowedTypes** Provide the ability to upload additional file types other than basic .jpg photos, e.g. PDF. You need to specify the extension and the MIME type in a new array element e.g. { "extension": ".pdf", "mime": "application/pdf" }



## Troubleshooting

Once the server is running, you can check the logs with

```
pm2 logs
```

Note: the permissions and ownership of the following files/directories may need to be expanded (try with 'chmod 777' at first, and then restrict the permissions once this is working).

```
/usr/lib/node_modules/medimage/config.json    # must be writable by the sudo node script
/usr/lib/node_modules/medimage/photos
```

```
chmod 777 config.json
chown nobody:ubuntu config.json           # nobody:ubuntu will vary slightly depending on platform
chmod 777 photos
chown nobody:ubuntu photos
```

If you are having problems installing the medimage software on a small machine (e.g. with 512MB RAM), please try 

```
sudo npm install -g medimage -production
```



## Upgrade script


The way to upgrade Medimage Server:

```
eval "$(curl -fsSL -H 'Cache-Control: no-cache' https://git.atomjump.com/medimageserv-linstaller.git/upgrade)" 
```

But, please note, that any files in the lib/node_modules/medimage/ directory may be removed, during the 'npm install' command. If you store any other files such as keys, ensure you copy them out before running this command.

(Or for a super user installation, which is sometimes required) 

```
eval "$(curl -fsSL -H 'Cache-Control: no-cache' https://git.atomjump.com/medimageserv-linstaller.git/upgrade-root)" 
```

You also may wish to save your config file somewhere else first, and then run:

```
npm config set medimage:configFile /path/to/your/medimage/config.json
```
Your settings will be kept between upgrades, provided the config.json is out of your global medimage directory,
without having to copy them out.




## Uninstall script

To remove any instances of MedImage Server:

```
eval "$(curl -fsSL -H 'Cache-Control: no-cache' https://git.atomjump.com/medimageserv-linstaller.git/uninstall)" 
```


# License

Application source code copyright (c) 2018 AtomJump Ltd. (New Zealand). All rights reserved.


Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

