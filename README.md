# MedImage Server

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

Where YOURIP is your server's IP address. You may be able to use https:// (TBC).
YOURCODE is your site's passcode, that each person can specify and keep private.  You choose this value, but please ensure that it is unguessable.
For example, you could have several hundred different practises operating off one proxy server, each with their own passcode.


## 3. On your Med Image Android app

Switch off Wifi on your phone.

Click the large circle.

After 5 seconds it will mention that you must enter a server. Enter your 'Server' after this as
```
"http://YOURIP:5566/write/YOURCODE"
```
where YOURCODE is the same site's passcode that was in your Windows config.json "readProxy" parameter.

Click the large icon to start taking photos.

Enter the patient id in the box at the top, specific to each photo. Note: #tags will allocate a directory (TBC this will create another subdirectory inside your directory). eg.
```
#elderly Fred
```
would create a directory called elderly/ on your PC and upload a file called 'Fred-[datetime]'

