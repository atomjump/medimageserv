# MedImage Server

The MedImage Server is a companion product to the MedImage apps on smart-phones. See http://medimage.atomjump.com

The combined product enables the medical practitioner to take a photo of a patient with their mobile phone, and have the image transferred directly into a specific folder on their PC or server.  The image is tagged with a patient id immediately before the photo is taken.

The most common way to install this package is to use an internet connected web-server as a 'proxy' (typically linux based), which temporarily holds the photos that are uploaded from the phone via 3G/4G to the server. A Windows Med Image reader sits on the Doctor's PC, which reads the proxy on a regular basis, and downloads images directly into a chosen folder (or folders) on the PC. 

## 1. To Install Your Proxy

This is useful when you cannot have a Wifi connection, and must go via a secure internet connection.

On a linux based server, first install NodeJS and npm.
See https://www.digitalocean.com/community/tutorials/how-to-install-node-js-on-an-ubuntu-14-04-server

Then:

```
git clone https://github.com/atomjump/medimageserv.git medimageserv
cd medimageserv
npm install
cp newconfig.js config.js      (this step is good for a fresh server-based setup)
node bin/server.js
```

Use 'forever' to ensure it runs as a daemon:
```
[sudo] npm install forever -g
mkdir /var/log/medimageserv
forever start -l /var/log/medimageserv/forever.log -o /var/log/medimageserv/out.log
                                        -e /var/log/medimageserv/err.log -a bin/server.js
```

To stop:
```
forever stop bin/server.js
```

To restart (after any config changes):
```
forever restart bin/server.js
```

Open the firewall to port 5566 for reading and writing:
```
sudo ufw allow 5566/tcp
```


Note: this daemon is always on, but the images are only kept on this machine for a few seconds.



## 2. On your Windows LAN server/desktop

Download and run the installable MedImageServer.exe from http://medimage.atomjump.com


Edit C:\MedImageServer\config.js

Set "readProxy" to be:
```
"readProxy" : "http://YOURIP:5566/read/YOURCODE"
```

Where YOURIP is your server's IP address. YOURCODE is your site's passcode, that each person can specify and keep private.  You choose this value, but please ensure that it is unguessable. For example, you could have several hundred different practises operating off one proxy server, each with their own passcode.

Then run 'Windows Services', find 'MedImage', and click 'Restart'.


## 3. On your Med Image Android app

Switch off Wifi on your phone.

Click the large circle.

After 5 seconds it will mention that you must enter a server. Enter your 'Server' after this as
```
"http://YOURIP:5566/write/YOURCODE"
```
where YOURCODE is the same site's passcode that was in your Windows config.json "readProxy" parameter.

Click the large icon to start taking photos.

Enter the patient id in the box at the top, specific to each photo. Note: #tags will allocate a directory (this will create another subdirectory inside your directory. This feature is to be completed.). eg.
```
#elderly Fred
```
would create a directory called elderly/ on your PC and upload a file called 'Fred-[datetime]'


### Planned Improvements

* https and http, rather than http support.
* Currently #tags will only create a useful directory if you are uploading to the entire server, not the /write/YOURCODE directory. Match this capability.
* config.json should be in Windows line ending format, so that Notepad users can more easily read it.
* Ensure all zero length files are removed - this may already be fixed.
* Queue images on client so that if there is no signal, the image is sent later.

 

