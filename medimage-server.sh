#!/bin/bash
cd "$(npm prefix -global)/lib/node_modules/medimage"
sudo chmod 777 config.json
sudo chmod 777 photos
npm run start


