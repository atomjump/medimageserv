# snapvoltserv

1. To Install Proxy
===================

On a linux based server:

git clone https://github.com/atomjump/medimageserv.git medimageserv
cd medimageserv
npm install
node bin/server.js

(TODO: use forever)

Note: this is always on, but the images are only kept on this machine temporarily.

2. On your Windows server/desktop
==============================

Download and run the installable MedImageServer.exe


Edit config.js

Set "readProxy" to be:
"http://YOURIP:5566/read/yourdir"

Where YOURIP is your server's IP address. You may be able to use https:// (TBC)
yourdir is your site's passcode


3. On your Med Image Android app
=============================

Switch off wifi on your phone.

Click the large icon.

After 5 seconds it will mention that you must be on wifi. Enter your 'Server' after this as
"http://YOURIP:5566/write/yourdir"

Click the large icon to start taking photos.

Enter the patient id in the box at the top. Note: #tags will allocate a directory (TBC this will create another subdirectory inside your directory).
eg. "#bestpatients Fred"
would create a directory called bestpatients/ on your PC and upload a file called 'Fred-[datetime]'

