const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const webpush = require('web-push');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// --- ??????? VAPID (???? ??????????) ---
// ??? ?????? ?? ?? ???? ??? ????????? ??????:
// https://web-push-codelab.glitch.me/
webpush.setVapidDetails(
  'mailto:your-email@example.com', // ????? ?????? ?? ???????
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// --- ????? ?? ??????? (MongoDB Atlas) ---
const MONGODB_URI = process.env.MONGODB_URI;
mongoose.connect(MONGODB_URI).then(() => console.log('? Connected to MongoDB'))
  .catch(err => console.error('? MongoDB Connection Error:', err));

// --- ?????? ??????? (Schem) ---
// ???? ?????? ?? ??????? ?????? ?? ?? ?? Collection ????? ???????
const AppStateSchema = new mongoose.Schema({
  data: { type: Object, required: true },
  updatedAt: { type: Date, default: Date.now }
});
const AppState = mongoose.model('AppState', AppStateSchema);

const SubscriptionSchema = new mongoose.Schema({
  userId: String,
  subscription: Object
});
const Subscription = mongoose.model('Subscription', SubscriptionSchema);


// --- API ?? ---

// ?. ?????? ?? ??????? ?? ???????
app.get('/api/state', async (req, res) => {
  try {
    let state = await AppState.findOne();
    if (!state) {
      return res.json({});
    }
    res.json(state.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ?. ????? ??????? ???? ?? ???????
app.post('/api/state', async (req, res) => {
  try {
    const newData = req.body;
    let state = await AppState.findOne();
    if (state) {
      state.data = newData;
      state.updatedAt = Date.now();
      await state.save();
    } else {
      await AppState.create({ data: newData });
    }
    
    // ????? ??????? ???? ?? ??? ?????????? ????
    io.emit('state-updated', newData);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ?. ??? ???? ???? (???? ??????????)
app.post('/api/subscribe', async (req, res) => {
  const { userId, subscription } = req.body;
  try {
    // ??? ???????? ???? ??? ?????
    await Subscription.deleteMany({ userId });
    // ????? ???? ????
    await Subscription.create({ userId, subscription });
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ?. ????? ?????????? (?? ?? ????? ??? ?? ???)
app.post('/api/notify', async (req, res) => {
  const { userId, title, body } = req.body;
  
  try {
    let subs;
    if (userId) {
      subs = await Subscription.find({ userId });
    } else {
      subs = await Subscription.find();
    }

    const payload = JSON.stringify({ title, body });

    subs.forEach(sub => {
      webpush.sendNotification(sub.subscription, payload).catch(err => {
        if (err.statusCode === 410 || err.statusCode === 404) {
          // ??? ???? ???? ??? ???? ?? ??????? ??? ???
          Subscription.findByIdAndDelete(sub._id).exec();
        }
      });
    });

    res.json({ success: true, sentTo: subs.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- WebSocket ???? ?????????? ???? ---
io.on('connection', (socket) => {
  console.log('?? A device connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('?? Device disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`?? Server running on port ${PORT}`);
});