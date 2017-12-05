Log Readme
==========

If you are running a Mac or Linux machine, you can check MedImage Server logs with the command

pm2 logs

If you are on Windows, this folder will have logs from the last day in the files

error.log
output.log

You can adjust the type of logging with standard nssm (See http://nssm.cc/usage) commands in an Administrator cmd box:

e.g. 

nssm set medimage AppRotateFiles 1
nssm set medimage AppRotateOnline 1
nssm set medimage AppRotateSeconds 86400
nssm set medimage AppRotateBytes 1048576