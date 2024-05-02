const express = require('express');
const multer = require('multer');
const { Server } = require('socket.io'); // Import socket.io
const http = require('http'); // Import http module for socket.io
const fetch = require('node-fetch');
// const AWS = require('aws-sdk');
const { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { RekognitionClient, DetectFacesCommand, IndexFacesCommand, SearchFacesByImageCommand } = require('@aws-sdk/client-rekognition');
const { DynamoDBClient, PutItemCommand, GetItemCommand, QueryCommand,ScanCommand } = require('@aws-sdk/client-dynamodb');
const cors = require('cors');
const ioClient = require('socket.io-client');

const app = express();
const port = process.env.PORT || 3000;

const server = http.createServer(app); // Create a server using http module
const io = new Server(server); // Initialize socket.io

// Configure AWS SDK
const s3Client = new S3Client({
  region: 'us-east-1', // Replace with your AWS region
  credentials: {
    accessKeyId: 'AKIA6CSSADJ73PBZT5WV',
    secretAccessKey: 'O8dzuMk9ZOQAgKLyD96fBr+6cfwgAvW8VbSEih0U',
  },
});

const rekognitionClient = new RekognitionClient({
  region: 'us-east-1', // Replace with your AWS region
  credentials: {
    accessKeyId: 'AKIA6CSSADJ73PBZT5WV',
    secretAccessKey: 'O8dzuMk9ZOQAgKLyD96fBr+6cfwgAvW8VbSEih0U',
  },
});
const dynamodbClient = new DynamoDBClient({
    region: 'us-east-1', // Replace with your AWS region
    credentials: {
      accessKeyId: 'AKIA6CSSADJ73PBZT5WV',
      secretAccessKey: 'O8dzuMk9ZOQAgKLyD96fBr+6cfwgAvW8VbSEih0U',
    },
  });

app.use(cors());



const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  });
  
  // Define an endpoint for file uploads
  app.post('/upload', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
  
      const fileName = req.file.originalname;
      const fileData = req.file.buffer;
  
      // Parse metadata from the request
      const metadata = JSON.parse(req.body.metadata);
  
      if (!metadata.FullName) {
        return res.status(400).json({ error: 'Metadata does not contain FullName' });
      }
  
      const params = {
        Bucket: 'famouspersons-image-dhriti', // Replace with your S3 bucket name
        Key: 'index/' + fileName,
        Body: fileData,
        Metadata: { FullName: metadata.FullName },
      };
  
      // Use AWS SDK v3 to upload the file with metadata
      const putObjectCommand = new PutObjectCommand(params);
      await s3Client.send(putObjectCommand);
  
      res.status(200).json({ message: 'File uploaded successfully' });
    } catch (error) {
      console.error('Error uploading file:', error);
      res.status(500).json({ error: 'Failed to upload file' });
    }
  });
  
  // Define an endpoint for recognizing faces
  app.post('/recognize', upload.single('file'), async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image file uploaded' });
        }
  
        const imageBuffer = req.file.buffer;
  
        const recognitionParams = {
            CollectionId: 'famouspersons',
            Image: { Bytes: imageBuffer },
            MaxFaces: 100 // Adjust this value according to your needs
        };
  
        // Detect faces in the uploaded image
        const faceDetectionResult = await rekognitionClient.send(new DetectFacesCommand({ Image: { Bytes: imageBuffer } }));
        const faceDetails = faceDetectionResult.FaceDetails;
  
        // Recognize faces in the image
        let similarImages = [];
        let names = [];
        let sex = [];
        let paginationToken = null;
  
        do {
            const recognitionResult = await rekognitionClient.send(new SearchFacesByImageCommand({ ...recognitionParams, NextToken: paginationToken }));
  
            if (!recognitionResult.FaceMatches || recognitionResult.FaceMatches.length === 0) {
                continue; // Skip if no face matches found
            }
  
            await Promise.all(recognitionResult.FaceMatches.map(async (faceMatch) => {
                const recognizedFaceId = faceMatch.Face.FaceId;
  
                // Retrieve all images associated with the recognized face ID from DynamoDB
                const params = {
                    TableName: 'FaceIdDataTable',
                    KeyConditionExpression: 'FaceID = :faceId',
                    ExpressionAttributeValues: {
                        ':faceId': { S: recognizedFaceId }
                    }
                };
  
                const { Items } = await dynamodbClient.send(new QueryCommand(params));
  
                // Add retrieved images to similarImages array
                Items.forEach(item => {
                    similarImages.push({
                        imageUrl: item.ImageURL.S,
                    });
                    const fullName = item.Metadata.S;
                    const metadata = JSON.parse(fullName);
                    const userName = metadata.Username;
                    const gender = metadata.Gender;
  
                    names.push({
                        name: userName,
                    });
  
                    sex.push({
                        gender: gender,
                    });
                });
            }));
  
            paginationToken = recognitionResult.NextToken;
  
        } while (paginationToken);
  
        if (similarImages.length > 0) {
            // Assuming you want to send data of the first similar image
            const firstSimilarImage = similarImages[0];
            const response = await fetch(firstSimilarImage.imageUrl);
            const imageBufferBase64 = await response.buffer();
            const base64Image = imageBufferBase64.toString('base64');
  
            // Emit the base64 encoded image
            const clientSocket = ioClient('http://192.168.1.226:3001');
            clientSocket.emit('img_send', { imageBase64: base64Image });
  
            // Assuming you want to send the first user's name and image URL
            const userName = names.length > 0 ? names[0].name : null;
            const imgURL = firstSimilarImage.imageUrl;
            console.log(userName, imgURL);
  
            res.status(200).json({ userName, imgURL });
        } else {
            res.status(404).json({ recognized: false });
        }
    } catch (error) {
        next(error);
    }
});


  
  // Start the server
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });

  
  io.on('connection', (socket) => {
    console.log('A user connected');
  
    // Handle recognition event
    socket.on('recognition', (data) => {
      console.log('Recognized image:', data);
  
      // Extract necessary data from 'data' object
      const { recognizedData, ipAddress } = data;
  
      // Send the recognized data to the specified IP address
      socket.to(ipAddress).emit('img_send', recognizedData);
    });
  
    // Handle disconnection
    socket.on('disconnect', () => {
      console.log('User disconnected');
    });
  });

