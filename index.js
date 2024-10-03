const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const dotenv = require('dotenv');
const http = require('http');
const { Server } = require('socket.io');

dotenv.config();

const app = express();
const server = http.createServer(app);

// CORS configuration for Socket.IO
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000", "https://global-news-server-five.vercel.app"], // Your frontend URL
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
    credentials: true
  }
});

// CORS configuration for Express
app.use(cors({
  origin: 'http://localhost:3000', // Client URL
  methods: ['GET', 'POST'], // Allowed methods
  allowedHeaders: ['Content-Type'], // Allowed headers
}));

app.use(express.json());
// MongoDB connection URI
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.dizfzlf.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with options for Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// Connect to MongoDB and set up the collections
async function run() {
  try {
    // Connect to MongoDB
    //await client.connect();

    // Collections
    const db = client.db('globalNewsDB');
    const usersCollection = db.collection('users');
    const newsCollection = db.collection('news');

    // Socket.IO connection
    io.on('connection', (socket) => {
      console.log('New client connected');

      // Send live news to the newly connected client
      const sendNewsToClient = async () => {
        try {
          const news = await newsCollection.find({ isLive: true }).sort({ timestamp: -1 }).toArray();
          socket.emit('liveNews', news);
        } catch (error) {
          console.error('Error fetching news:', error);
        }
      };

      sendNewsToClient();

      // Listen for new news posted
      socket.on('newNews', async (newsArticle) => {
        try {
          await newsCollection.insertOne(newsArticle);
          io.emit('newsPosted', newsArticle); // Broadcast new article to all clients
        } catch (error) {
          console.error('Error posting news:', error);
        }
      });

      socket.on('disconnect', () => {
        console.log('Client disconnected');
      });
    });

    // API route to post news
    app.post('/news', async (req, res) => {
      const newsArticle = {
        ...req.body,
        timestamp: new Date(),
      };

      try {
        const result = await newsCollection.insertOne(newsArticle);
        io.emit('newsPosted', newsArticle); // Broadcast to all clients
        res.status(201).json(result);
      } catch (error) {
        console.error('Error posting news:', error);
        res.status(500).json({ message: 'Failed to post news' });
      }
    });

    // User Registration
    app.post('/register', async (req, res) => {
      const user = req.body;
      user.role = 'Normal User';
      user.status = 'Active';

      const existingUser = await usersCollection.findOne({ email: user.email });
      if (existingUser) {
        return res.status(400).json({ message: 'User already exists' });
      }

      const result = await usersCollection.insertOne(user);
      res.status(201).send(result);
    });

    // API route to get all news with optional filtering
    app.get('/news', async (req, res) => {
      try {
        const { category, region, date } = req.query;
        let filter = {};

        if (category && category !== 'All') {
          filter.category = category;
        }
        if (region && region !== 'All') {
          filter.region = region;
        }
        if (date) {
          const now = new Date();
          if (date === 'today') {
            filter.timestamp = { $gte: new Date(now.setHours(0, 0, 0)), $lt: new Date(now.setHours(23, 59, 59)) };
          } else if (date === 'this_week') {
            const startOfWeek = new Date(now);
            startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday
            filter.timestamp = { $gte: startOfWeek, $lte: now };
          } else if (date === 'this_month') {
            filter.timestamp = { $gte: new Date(now.getFullYear(), now.getMonth(), 1), $lte: now };
          }
        }

        const news = await newsCollection.find(filter).sort({ timestamp: -1 }).toArray();
        res.status(200).json(news);
      } catch (error) {
        res.status(500).json({ message: 'Error fetching news', error });
      }
    });

    // Request to become a Reporter
    app.post('/request-reporter', async (req, res) => {
      const { email } = req.body;
      const result = await usersCollection.updateOne(
        { email },
        { $set: { status: 'Requested' } }
      );

      res.send(result);
    });

    // Admin approves or cancels request
    app.patch('/admin/approve-request', async (req, res) => {
      const { email, action } = req.body;
      if (action === 'approve') {
        const result = await usersCollection.updateOne(
          { email },
          { $set: { role: 'Reporter', status: 'Approved' } }
        );
        return res.send(result);
      } else if (action === 'cancel') {
        const result = await usersCollection.updateOne(
          { email },
          { $set: { status: 'Denied' } }
        );
        return res.send(result);
      }

      res.status(400).json({ message: 'Invalid action' });
    });

    // Manage Users (Admin)
    app.put('/admin/manage-user', async (req, res) => {
      const { email, action, updatedUser } = req.body;
      if (action === 'delete') {
        const result = await usersCollection.deleteOne({ email });
        return res.send(result);
      } else if (action === 'edit') {
        const result = await usersCollection.updateOne(
          { email },
          { $set: updatedUser }
        );
        return res.send(result);
      }

      res.status(400).json({ message: 'Invalid action' });
    });

    // Get My Articles (Reporter)
    app.get('/my-articles/:email', async (req, res) => {
      const email = req.params.email;
      const articles = await newsCollection.find({ author: email }).toArray();
      res.send(articles);
    });

    // Edit or Delete My Articles (Reporter)
    app.patch('/news/:id', async (req, res) => {
      const { id } = req.params;
      const { action, updatedArticle } = req.body;

      if (action === 'delete') {
        const result = await newsCollection.deleteOne({ _id: id });
        return res.send(result);
      } else if (action === 'edit') {
        const result = await newsCollection.updateOne(
          { _id: id },
          { $set: updatedArticle }
        );
        return res.send(result);
      }

      res.status(400).json({ message: 'Invalid action' });
    });

    // Bookmark News (Normal User)
    app.post('/bookmark', async (req, res) => {
      const { email, newsId } = req.body;
      const result = await usersCollection.updateOne(
        { email },
        { $addToSet: { bookmarks: newsId } }
      );
      res.send(result);
    });

    // Get Bookmarked News (Normal User)
    app.get('/bookmarks/:email', async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      res.send(user.bookmarks);
    });

    // get popular news
    app.get('/news/:id', async (req, res) => {
      const { id } = req.params;
      console.log(id)
      const query = { _id: new ObjectId(id) }
      const result = await newsCollection.findOne(query);
      res.send(result)
    })

    // get latest news
    app.get('/newss/latestNews', async (req, res) => {
      try {
        const allNews = await newsCollection.find({}).sort({ timestamp: -1 }).limit(7).toArray();
        res.send(allNews);
      } catch (error) {
        res.status(500).send({ message: 'Failed to fetch latest news', error });
      }
    });



    // Ping MongoDB to confirm connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
  }
}

// Start the server on port 3001
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Connect to MongoDB
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Global news server is running...");
});
