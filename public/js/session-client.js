// Sessions


function cookieOffset()
{
  //Should output: Thu,31-Dec-2020 00:00:00 GMT
  var cdate = new Date;
  var expirydate=new Date();
  expirydate.setTime(expirydate.getTime()+(365*3*60*60*24*1000))
  var write = expirydate.toGMTString();

  return write;
}


function myTrim(x)
{
	return x.replace(/^\s+|\s+$/gm,'');
}

function getCookie(cname)
{
	var name = cname + "=";
	var ca = document.cookie.split(';');
	for(var i=0; i<ca.length; i++)
	{
		var c = myTrim(decodeURIComponent(ca[i]));// ie8 didn't support .trim();
		if (c.indexOf(name)==0) return c.substring(name.length,c.length);
	}
	return "";
}


function setCookie(sessionId) {

	//See http://stackoverflow.com/questions/4901633/how-to-store-other-languages-unicode-in-cookies-and-get-it-back-again
	document.cookie = 'sessionId=' + sessionId + '; path=/; expires=' + cookieOffset() + ';';
}


function logout(cb) {

	var sessionId = getCookie("sessionId");
	if(sessionId) {
		var uri = "/addon/get-session";
		jQuery.ajax({
				url: uri,
				data: { sessionId: sessionId,
						logout: true },
				success: function(data) {
		
					var myobj = JSON.parse(data);
					if(myobj.success == true) {
							setCookie("");
				
							//And display the login details
							cb(null);
					} else {
						cb("Sorry, there was a problem logging out. Please try again.");
					}
				}
			}); 
	} else {
		cb("Sorry, you don't seem to be logged in?");
	
	}
  
	event.preventDefault();
	return false;

}


function checkSessionValid(sessionId, cb) {
	var uri = "/addon/get-session";
						
	jQuery.ajax({
		url: uri,
		data: { sessionId: sessionId },
		success: function(data) {
		
			var myobj = JSON.parse(data);
			if(myobj.success == true) {
				cb(null);
			} else {
				cb("Sorry, that session ID is not valid."); 
			}
		}
	}); 

}
