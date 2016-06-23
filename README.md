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

If you have installed your own proxy, enter the URL of your proxy server eg. 'http://myproxy.mycompany.com:5566' into the third large button. You will be given a 4 digit pairing code.



## 3. On your Med Image Android app 

Search the Play Store for 'Med Image'. Purchase and install.

Click the large circle on the app to connect and start taking photos. If you have no wifi connection it will ask you for your 4 digit pairing code from your server.

Enter the patient id in the box at the top, specific to each photo. Note: #tags will allocate a directory (this will create another subdirectory inside your directory.). eg.
```
#elderly Fred
```
would create a directory called elderly/ on your PC and upload a file called 'Fred-[datetime]'


### Planned Improvements

* https and http, rather than http support.
* Queue images on client so that if there is no signal, the image is sent later.
* Had one report of an image being sent but an incomplete .jpg came through.
 

