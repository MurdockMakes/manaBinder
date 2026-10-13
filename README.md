# ManaBinder

A Magic: The Gathering binder and local trading app using Node.js, PostgreSQL and vanilla JavaScript. Public binders show printing, finish, condition and quantity; collection locations and wanted lists are private. Prices are fetched only for explicit quotes/sends and never stored on listings or returned through catalog/binder APIs.

# Download Instructions:

No download needed -- Will be web hosted here {URL}.


## Use Instructions:
  (Screenshots will be added for all steps)
  Create an account
  
  Upload you magic the gathering collection 

  Filter to local game stores near you to view trade binders of their regulars the algorithm should match you with players that have cards you are looking for that want cards that you have available for trade, making trading easy!
  
Initiate a trade! (They may counter offer or deny) 

Set a meeting time, once a trade is initiated (not finalized) you will get access to a scheduling window where you can plan to meet at an LGS (select from the dropdown menu)


  
  
## Public API Access: 

Pull LGS List (populates the list of LGS locations in a .json
Import collection as deckles -- For Moxfield collection adding it exports your full collection that has been uploaded to a deckles so that you can just add to collection, (no duplication of work!)  Eventually I will get around to bothering them for API access so it will seamlessly integrate in!

