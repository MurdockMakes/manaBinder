# ManaBinder

A Magic: The Gathering binder and local trading app using Node.js and PostgreSQL. 

Manabinder is a web app primarily for organizing your Magic Collections, and sharing a trade binder all while connecting with new people at game store you may not have been to before! The binder will contain information about the printing, finish (foil/non-foil), and quantity available. There is also a private collection and wanted list separate from the public binder!

This project is under active development and currently is not publicly hosted. The long term goal is to match nearby players with matching trade interests (even matching multi-trades) and facilitating meeting up at a local game store to make the final trade. Pricing is deliberately separated from the catalog and binder APIs to encourage players to maybe accept a dollar or two loss every now and then instead of being focused on profit. 

# Download Instructions:

## Dependencies
  Node.js >= 22.23.2 <23 
  npm for installing dependencies
  PostgresSql: the included Compose config uses PostgresSQL 18.4
  Docker with Compose Make running the local database easy, also there for larger deployments 
  Git for cloning the repository
## Local Development 
  Clone the repository and install dependencies: 
    (git clone cd npm ci that whole thing -- will flesh out later) 
  Create local config from the example 

  To start the postgresSql container: 
    docker compose up -d db
    **Need to also show how to run the migration scripts

        
## Use Instructions:
  (Screenshots will be added for all steps once the front end isn't placeholder slop)
  Create an account
  
  Upload you magic the gathering collection 

  Prepare trade binder: expose which cards you want others trading for while keeping your full collection private (this is for saftey) 

*The following features are in development and not yet done, but are part of the MVP 
  
  Filter to local game stores near you to view trade binders of their regulars the algorithm should match you with players that have cards you are looking for that want cards that you have available for trade, making trading easy!
  
Initiate a trade! (They may counter offer or deny) 

Set a meeting time, once a trade is initiated (not finalized) you will get access to a scheduling window where you can plan to meet at an LGS (select from the dropdown menu)


## Features and Roadmap 
### Card Scanning
Use phone camera, or webcam to scan cards while noting finish, card name, set, printing etc. 
### Private and Public Data Separation
Public binders will not expose private collection locations or wanted lists

### On-demand pricing 
Pricing can only be viewed in the private collection, but is pulled so the backend can determine if a trade is fair. 

### Local Trading focus 
The intended discovery largely focuses on nearby players, and game stores. To hopefully facilitate a stronger community. 
  
## Public API Access: 

### Authentication 
  App uses signed session cookies. Passwords are stored as salted scrypt hashes. It include creation, login, and logout features. 

### App Data
The app architecture keeps catalog info, binders, private collections, wanted lists, and pricing requests. Not everything is intended to be public and access depends on the session and authorization requirements. 


### External Data integrations

  Scryfall: Card cataloug import and pricing data workflows
  WPN Play network store data: local game store import 
  AMQP/Prometheus: supports infrastructure and dependencies present in the project 


### Contributing 
Don't! 

Lisence: 
Currently Unlicensed

