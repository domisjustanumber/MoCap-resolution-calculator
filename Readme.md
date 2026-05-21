## Minimum Resolvable Object
Think of this chart as the spatial accuracy of the system. If the chart says 10mm at 2m, that means two objects that are 2m from the camera and less than 10mm apart will appear as one single object to the camera.

### Inputs
Sensor size
Capture size
Lens field of view, f/ stop

## How to improve results
1. Increase capture resolution
2. Decrease camera field of view (less is visible in the frame / more zoomed in)
3. Decrease distance from the camera

## Camera sync error
This chart plots the affect of camera sync issues on the spatial accuracy of the system. It demonstrates the issues that camera timing offsets can have on accuracy.

### Inputs
- Distance from the camera
- Velocity of object (how fast is the thing you want to track moving)
- Camera timing offset (what is the range of camera shutter times. i.e. if camera 1 fires 5ms before camera 2, and camera 3 fires another 5ms later, your phase offset is 10ms).
- Camera timing jitter - how much unreliability in timing is there from either one camera to the next, or the pacing of the frames from any camera. e.g. if you only know the accuracy of the time you captured the frame to 10ms, then your jitter is 10ms. It has a huge impact on accuracy!

## How to improve results
- Better camera timing! Know when the image was taken, keep the cameras synchronised as tightly as possible.
- Track slower stuff. Boring, but a reality of using USB cameras that have inherently unreliable timing

## Spatial Resolution


