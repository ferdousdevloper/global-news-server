const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(cors());
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

    // Get all news (Normal User)
    app.get('/news', async (req, res) => {
      try {
        const newsArticles = await newsCollection.find({}).toArray();
        res.status(200).json(newsArticles);
      } catch (error) {
        console.error('Error fetching news:', error);
        res.status(500).json({ message: 'Failed to fetch news' });
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

    // Create News (Reporter)
    app.post('/news', async (req, res) => {
      const newsArticle = req.body;
      const result = await newsCollection.insertOne(newsArticle);
      res.status(201).send(result);
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

    // Ping MongoDB to confirm connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
  }
}

// Start the server on port 3001
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Connect to MongoDB
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("global news server is running....");
});
