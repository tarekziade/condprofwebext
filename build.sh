#!/bin/bash
rm condprof.xpi
cd src && zip -r ../condprof.xpi . -x .DS_Store && cd ..
