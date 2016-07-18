# MedImage Server

The MedImage Server is a companion product to the MedImage apps on smart-phones. See http://medimage.atomjump.com

The combined product enables the medical practitioner to take a photo of a patient with their mobile phone, and have the image transferred directly into a specific folder on their PC or server.  The image is tagged with a patient id immediately before the photo is taken.

The most common way to install this package is to use an internet connected PC as a 'proxy' (typically linux based), which temporarily holds the photos that are uploaded from the phone via 3G/4G to the server. A Windows Med Image reader sits on the Doctor's PC, which reads the proxy on a regular basis, and downloads images directly into a chosen folder (or folders) on the PC. 

## 1. To Install Your Proxy

This is useful when you cannot have a Wifi connection, and must go via a secure internet connection.

On a linux based server, first install NodeJS and npm.
See https://www.digitalocean.com/community/tutorials/how-to-install-node-js-on-an-ubuntu-14-04-server

Then:

```
sudo npm install pm2@latest -g
npm install medimage -g
pm2 start /usr/lib/node_modules/medimage/bin/server.js   (check your medimage is installed there)
pm2 startup     (and run the command it outputs, to get autostart at boot-up)
```

You may have to open the firewall to port 5566 for reading and writing eg.:
```
sudo ufw allow 5566/tcp
```


To start MedImage server
```
pm2 start server
```

To stop MedImage server:
```
pm2 stop server
```

To restart (after any config.json changes):
```
pm2 restart server
```




Note: this proxy daemon is always on, but the images are only kept on this machine for a few seconds.



## 2. On your Windows PC/local server

Download and run the installable MedImageServer.exe from http://medimage.atomjump.com

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



