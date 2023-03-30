# contentful-import-script Instructions
1-You can install ts-node in order to run the script directly
2-Set up the .env file with the required data
3-At the end of the script file there is a call to the function importDataToContentfulFlow which triggers the import flow.
  You need to fill the parameters with the right data before you run the script.
4-Then execute ts-node --esm src/script.ts