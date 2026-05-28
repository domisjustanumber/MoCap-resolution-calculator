# [MoCap System Resolution Calculator](https://domisjustanumber.github.io/MoCap-resolution-calculator/)
Hopefully this helps you calculate theoretical minimum resolvable objects when using a Motion Capture system.

## Spatial
The Spatial tab sets up your camera. Select your camera, motion type, light level and click optimize to find out what the minimum spatial resolution is. You also get a plot for maximum velocity before motion blur makes it impossible to track, and a suggested minimum ChAruCo square length.

## Temporal
On the Temporal tab you can see what effects camera timing offsets will have on your tracking, along with a (rough) 3D visualisation.
By default, these values are not linked to the Spatial Resolution chart, but if you enable Linked mode, they are all locked together and the temporal offsets will reflect in your spatial resolution. You will also only get valid settings for the camera you have selected in the Temporal Resolution chart.

## Caveats
This is all vibe coded, so double check calculations. It's very likely wrong in places.
