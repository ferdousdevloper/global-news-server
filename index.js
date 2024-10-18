const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const dotenv = require("dotenv");
const http = require("http");
const { Server } = require("socket.io");
const nodemailer = require("nodemailer");
dotenv.config();

const app = express();
const server = http.createServer(app);

// CORS configuration for Socket.IO
const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:3000",
      "https://global-news-client.vercel.app",
      "https://global-news-gama.netlify.app",
      "https://illustrious-melomakarona-23aba4.netlify.app",
    ],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type"],
    credentials: true,
  },
});

// CORS configuration for Express
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "https://global-news-client.vercel.app",
      "https://global-news-gama.netlify.app",
      "https://illustrious-melomakarona-23aba4.netlify.app",
    ], // Client URL
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"], // Allowed methods
    allowedHeaders: ["Content-Type"], // Allowed headers
  })
);

app.use(express.json());
// send email
const sendEmail = (emailAddress, emailData) => {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: process.env.TRANSPORTER_EMAIL,
      pass: process.env.TRANSPORTER_PASS,
    },
  });
  // verify connection
  transporter.verify(function (error, success) {
    if (error) {
      console.log(error);
    } else {
      console.log("Server is ready to take our messages");
    }
  });
  const mailBody = {
    from: `"GlobalNews" <${process.env.TRANSPORTER_EMAIL}>`,
    to: emailAddress,
    subject: emailData.subject,
    html: emailData.message,
  };

  transporter.sendMail(mailBody, (error, info) => {
    if (error) {
      console.log(error);
    } else {
      console.log("Email Sent: " + info.response);
    }
  });
};

// MongoDB connection URI
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.dizfzlf.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with options for Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Connect to MongoDB and set up the collections
async function run() {
  try {
    // Connect to MongoDB
    // await client.connect();

    // Collections
    const db = client.db("globalNewsDB");
    const usersCollection = db.collection("users");
    const newsCollection = db.collection("news");

    // Socket.IO connection
    io.on("connection", (socket) => {
      console.log("New client connected");

      // Send latest live news to the newly connected client
      const sendNewsToClient = async () => {
        try {
          const news = await newsCollection
            .find({ isLive: true })
            .sort({ timestamp: -1 })
            .limit(1)
            .toArray();
          if (news.length > 0) {
            socket.emit("liveNews", news); // Emit only the latest live news
          }
        } catch (error) {
          console.error("Error fetching news:", error);
        }
      };

      sendNewsToClient();

      // Listen for new news posted
      socket.on("newNews", async (newsArticle) => {
        try {
          await newsCollection.insertOne(newsArticle);
          io.emit("newsPosted", newsArticle); // Broadcast new article to all clients
          // Emit the new live article to all clients if it's live
          if (newsArticle.isLive) {
            io.emit("liveNews", [newsArticle]); // Send the new live article
          }
        } catch (error) {
          console.error("Error posting news:", error);
        }
      });

      socket.on("disconnect", () => {
        console.log("Client disconnected");
      });
    });

    // API route to post news
    app.post("/news", async (req, res) => {
      const newsArticle = {
        ...req.body,
        timestamp: new Date(),
      };

      try {
        const result = await newsCollection.insertOne(newsArticle);
        io.emit("newsPosted", newsArticle); // Broadcast to all clients
        // Emit the new live article if it's live
        if (newsArticle.isLive) {
          io.emit("liveNews", [newsArticle]);
        }
        res.status(201).json(result);
      } catch (error) {
        console.error("Error posting news:", error);
        res.status(500).json({ message: "Failed to post news" });
      }
    });

    // User Registration
    app.post("/register", async (req, res) => {
      const user = req.body;
      user.role = "Normal User";
      user.status = "Active";

      const existingUser = await usersCollection.findOne({ email: user.email });
      if (existingUser) {
        return res.status(400).json({ message: "User already exists" });
      }

      const result = await usersCollection.insertOne(user);

      // welcome message to email
      sendEmail(user?.email, {
        subject: "Welcome to the Global News website!",
        message: `Hope you will find a lot of resources which you find`,
      });
      res.status(201).send(result);
    });

    // API route to get all news with optional filtering
    app.get("/news", async (req, res) => {
      const pages = parseInt(req.query.pages);
      const size = parseInt(req.query.size);
      try {
        const { category, region, date } = req.query;
        let filter = {};

        if (category && category !== "All") {
          filter.category = category;
        }
        if (region && region !== "All") {
          filter.region = region;
        }
        if (date) {
          const now = new Date();
          if (date === "today") {
            filter.timestamp = {
              $gte: new Date(now.setHours(0, 0, 0)),
              $lt: new Date(now.setHours(23, 59, 59)),
            };
          } else if (date === "this_week") {
            const startOfWeek = new Date(now);
            startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday
            filter.timestamp = { $gte: startOfWeek, $lte: now };
          } else if (date === "this_month") {
            filter.timestamp = {
              $gte: new Date(now.getFullYear(), now.getMonth(), 1),
              $lte: now,
            };
          }
        }

        const news = await newsCollection
          .find(filter)
          .sort({ timestamp: -1 })
          .skip(pages * size)
          .limit(size)
          .toArray();
        res.status(200).json(news);
      } catch (error) {
        res.status(500).json({ message: "Error fetching news", error });
      }
    });

    // get specific news

    // Request to become a Reporter
    app.post("/request-reporter", async (req, res) => {
      const { email } = req.body;
      const result = await usersCollection.updateOne(
        { email },
        { $set: { status: "Requested" } }
      );

      res.send(result);
    });

    // Route to fetch pending reporter requests
    app.get("/pending-reporter-requests", async (req, res) => {
      try {
        // Query to find users with role "Normal User" and status "Requested"
        const pendingRequests = await usersCollection
          .find({ role: "Normal User", status: "Requested" })
          .toArray();

        // Send the list of pending requests as JSON
        res.status(200).json(pendingRequests);
      } catch (error) {
        console.error("Error fetching pending reporter requests:", error);
        res.status(500).json({ message: "Failed to fetch pending requests." });
      }
    });

    // Admin approves or cancels request
    app.patch("/admin/approve-request", async (req, res) => {
      const { email, action } = req.body;
      if (action === "approve") {
        const result = await usersCollection.updateOne(
          { email },
          { $set: { role: "Reporter", status: "Approved" } }
        );
        return res.send(result);
      } else if (action === "cancel") {
        const result = await usersCollection.updateOne(
          { email },
          { $set: { status: "Denied" } }
        );
        return res.send(result);
      }
      res.status(400).json({ message: "Invalid action" });
    });

    // Manage Users (Admin)
    app.put("/admin/manage-user", async (req, res) => {
      const { email, action, updatedUser } = req.body;
      if (action === "delete") {
        const result = await usersCollection.deleteOne({ email });
        return res.send(result);
      } else if (action === "edit") {
        const result = await usersCollection.updateOne(
          { email },
          { $set: updatedUser }
        );
        return res.send(result);
      }

      res.status(400).json({ message: "Invalid action" });
    });

    // Get My Articles (Reporter)
    app.get("/news/my-articles/:email", async (req, res) => {
      const email = req.params.email;
      const articles = await newsCollection.find({ author: email }).toArray();
      res.send(articles);
    });

    // Delete an article by ID
app.delete('/news/delete-article/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await newsCollection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Article not found' });
    }
    res.status(200).json({ message: 'Article deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting article' });
  }
});

app.get('/news/get-article/:articleId', async (req, res) => {
  const { articleId } = req.params;

  try {
    const article = await newsCollection.findOne({ _id: new ObjectId(articleId) });

    if (!article) {
      return res.status(404).json({ message: 'Article not found' });
    }

    res.json(article);
  } catch (error) {
    console.error('Error fetching article:', error);
    res.status(500).json({ message: 'Error fetching article' });
  }
});

app.patch('/news/edit-article/:articleId', async (req, res) => {
  const { articleId } = req.params;
  const { title, description, image, category, region, breaking_news, popular_news, isLive } = req.body;

  try {
    // Find the article by ID and update it with new data
    const result = await newsCollection.updateOne(
      { _id: new ObjectId(articleId) },
      {
        $set: {
          title,
          description,
          image,
          category,
          region,
          breaking_news,
          popular_news,
          isLive,
        }
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Article not found' });
    }

    res.json({ message: 'Article updated successfully' });
  } catch (error) {
    console.error('Error updating article:', error);
    res.status(500).json({ message: 'Error updating article' });
  }
});

    // Edit or Delete My Articles (Reporter)
    app.patch("/news/:id", async (req, res) => {
      const { id } = req.params;
      const { action, updatedArticle } = req.body;

      if (action === "delete") {
        const result = await newsCollection.deleteOne({ _id: id });
        return res.send(result);
      } else if (action === "edit") {
        const result = await newsCollection.updateOne(
          { _id: id },
          { $set: updatedArticle }
        );
        return res.send(result);
      }

      res.status(400).json({ message: "Invalid action" });
    });
    // Bookmark News (Normal User)
    app.post("/bookmark", async (req, res) => {
      const { email, newsId } = req.body;

      try {
        const result = await usersCollection.updateOne(
          { email },
          { $addToSet: { bookmarks: newsId } }
        );
        res.send(result);
      } catch (error) {
        res.status(500).json({ message: "Error adding bookmark", error });
      }
    });

    // Remove Bookmark (Normal User)
   // API route to remove a favorite
app.delete("/bookmarks", async (req, res) => {
  const { email, newsId } = req.body;

  try {
    const result = await usersCollection.updateOne(
      { email },
      { $pull: { bookmarks: newsId } } // Remove newsId from favorites array
    );
    res.send(result);
  } catch (error) {
    res.status(500).json({ message: "Error removing bookmark", error });
  }
});

   // API route to get user's favorites
app.get("/bookmarks/:email", async (req, res) => {
  const email = req.params.email;

  try {
    const user = await usersCollection.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Fetch the news details corresponding to the favorite newsIds if needed
    const bookmarks = user.bookmarks || [];
    res.send(bookmarks);
  } catch (error) {
    res.status(500).json({ message: "Error retrieving bookmarks", error });
  }
});
    

// API route to add a favorite
app.post("/favorites", async (req, res) => {
  const { email, newsId } = req.body;

  try {
    const result = await usersCollection.updateOne(
      { email },
      { $addToSet: { favorites: newsId } } // Add newsId to favorites array
    );
    res.send(result);
  } catch (error) {
    res.status(500).json({ message: "Error adding favorite", error });
  }
});

// API route to remove a favorite
app.delete("/favorites", async (req, res) => {
  const { email, newsId } = req.body;

  try {
    const result = await usersCollection.updateOne(
      { email },
      { $pull: { favorites: newsId } } // Remove newsId from favorites array
    );
    res.send(result);
  } catch (error) {
    res.status(500).json({ message: "Error removing favorite", error });
  }
});

// API route to get user's favorites
app.get("/favorites/:email", async (req, res) => {
  const email = req.params.email;

  try {
    const user = await usersCollection.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Fetch the news details corresponding to the favorite newsIds if needed
    const favorites = user.favorites || [];
    res.send(favorites);
  } catch (error) {
    res.status(500).json({ message: "Error retrieving favorites", error });
  }
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


    // get news according to region , category , title..
    app.get('/newss/filter', async (req, res) => {
      const { region, category, topic } = req.query;

      let query = {};

      if (region) {
        query.region = region;
      }

      if (category) {
        query.category = category;
      }

      if (topic) {
        query.title = topic; 
      }

      try {
        const filteredNews = await newsCollection.find(query).toArray();

        if (filteredNews.length > 0) {
          return res.send(filteredNews);
        } else {
          return res.status(404).send({ message: 'Nothing found...' });
        }
      } catch (error) {
        console.error('Error fetching news:', error);
        return res.status(500).send({ message: 'Internal server error' });
      }
    });


    // Find admin----------------------------
    app.get("/users/admin/:email", async (req, res) => {
      const email = req.params.email;
      console.log("Fetching admin status for:", email); // Log the email

      const query = { email: email };
      const user = await usersCollection.findOne(query);

      if (!user) {
        console.log("User not found"); // Log when user is not found
        return res.status(404).send({ message: "User not found" });
      }

      const admin = user?.role === "admin";
      res.send({ admin });
    });

    // Get all users
    app.get("/users", async (req, res) => {
      try {
        const users = await usersCollection.find().toArray(); // fetch all users
        res.send(users);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch users" });
      }
    });

    // Get user by email
    app.get("/user/:email", async (req, res) => {
      try {
        const email = req.params.email; // Get the email from the URL
        const user = await usersCollection.findOne({ email }); // Query the usersCollection by email

        if (!user) {
          return res.status(404).json({ message: "User not found" }); // If user is not found
        }

        res.status(200).json(user); // Send back the user data if found
      } catch (error) {
        console.error("Error fetching user by email:", error);
        res.status(500).json({ message: "Error fetching user data" }); // Handle errors
      }
    });

    // Make normal user to admin for admin dashboard----------------

    app.patch("/users/admin/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          role: "admin",
        },
      };
      const result = await usersCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    // delete user for admin dashboard----------------
    app.delete("/users/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await usersCollection.deleteOne(query);
        if (result.deletedCount === 0) {
          return res.status(404).send({ message: "User not found" });
        }
        res.send(result);
      } catch (error) {
        console.error("Error deleting user:", error);
        res.status(500).send({ message: "Failed to delete user" });
      }
    });

    //block normal user ----------------
    app.patch("/users/block/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          status: "block",
        },
      };
      const result = await usersCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    // active blocked user
    app.patch("/users/active/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          status: "active",
        },
      };
      const result = await usersCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    // For news details page
    app.get("/news/:id", async (req, res) => {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid news ID" });
      }

      try {
        const newsItem = await newsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (newsItem) {
          res.json(newsItem);
        } else {
          res.status(404).send({ message: "News not found" });
        }
      } catch (error) {
        console.error("Error fetching news:", error);
        res.status(500).send({ message: "Internal Server Error", error });
      }
    });


    // DASHBOARD  Fetch all news--------------
    app.get("/news", async (req, res) => {
      try {
        const news = await newsCollection.find().toArray();
        res.json(news);
      } catch (error) {
        res.status(500).send(error.message);
      }
    });

    // DASHBOARD Update news-----------------
    app.put("/news/:id", async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;
      try {
        const result = await newsCollection.updateOne(
          { _id: ObjectId(id) },
          { $set: updatedData }
        );
        res.json(result);
      } catch (error) {
        res.status(500).send(error.message);
      }
    });

    // DASHBOARD Delete news------------------
    app.delete("/news/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await newsCollection.deleteOne(query);
        if (result.deletedCount === 0) {
          return res.status(404).send({ message: "User not found" });
        }
        res.send(result);
      } catch (error) {
        console.error("Error deleting user:", error);
        res.status(500).send({ message: "Failed to delete user" });
      }
    });

    // // Update news item
    // // Update news item
    // app.put("/news/:id", async (req, res) => {
    //   const id = req.params.id;

    //   // Validate the ObjectId format
    //   if (!ObjectId.isValid(id)) {
    //     return res.status(400).send("Invalid Object ID format");
    //   }

    //   const updateData = req.body;
    //   const filter = { _id: new ObjectId(id) };

    //   try {
    //     console.log("Updating news item:", updateData);

    //     const result = await newsCollection.updateOne(filter, {
    //       $set: {
    //         image: updateData.image,
    //         title: updateData.title,
    //         category: updateData.category,
    //         region: updateData.region,
    //         description: updateData.description,
    //         date_time: updateData.date_time,
    //         breaking_news: updateData.breaking_news,
    //         popular_news: updateData.popular_news,
    //       },
    //     });

    //     if (result.matchedCount === 0) {
    //       return res.status(404).send("News item not found");
    //     }

    //     if (result.modifiedCount === 0) {
    //       return res.status(400).send("No changes were made");
    //     }

    //     res.status(200).send("News item updated successfully");
    //   } catch (error) {
    //     console.error("Error updating news:", error);
    //     res.status(500).send("Error updating news: " + error.message);
    //   }
    // });

    // Ping MongoDB to confirm connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
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
