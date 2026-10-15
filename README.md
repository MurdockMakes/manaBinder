# ManaBinder

A Magic: The Gathering binder and local trading app using Node.js, PostgreSQL and vanilla JavaScript. Public binders show printing, finish, condition and quantity; collection locations and wanted lists are private. Prices are fetched only for explicit quotes/sends and never stored on listings or returned through catalog/binder APIs.

# Download Instructions:

No download needed -- web hosted here {no url yet I don't got web hosting kinda money right now}.


## Use Instructions:
  (Screenshots will be added for all steps once the front end isn't placeholder slop)
  Create an account
  
  Upload you magic the gathering collection 

  Filter to local game stores near you to view trade binders of their regulars the algorithm should match you with players that have cards you are looking for that want cards that you have available for trade, making trading easy!
  
Initiate a trade! (They may counter offer or deny) 

Set a meeting time, once a trade is initiated (not finalized) you will get access to a scheduling window where you can plan to meet at an LGS (select from the dropdown menu)


  
  
## Public API Access: 

### Authentication 
  App uses signed session cookies. Passwords are stored as salted scrypt hashes. 

  POST `<signup route>`  Creates an account
  POST `<login route>`   Log in and establish a session 
  POST `<logout route>`  End the current session

### App Endpoints


### External Data integrations


### Example Requests
