import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import crypto from "crypto";
import Razorpay from "razorpay";
import authenticate from "./authMiddleware.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use("/images", express.static("images"));
app.use("/image", express.static("images"));

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_API_KEY,
    key_secret: process.env.RAZORPAY_API_SECRET,
});

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/db1";

mongoose.connect(MONGODB_URI).then(() => {
    console.log("DB CONNECTED");
}).catch(() => {
    console.log("DB Not Connected");
});

const UserModel = mongoose.model("usermodel", {
    name: String,
    mail: String,
    cart: Array,
    orders: Array,
}, "users");

app.get("/user", authenticate, async (req, res) => {
    const data = await UserModel.findOne({
        mail: req.user.email
    });
    res.json(data || null);
});

const ProductModel = mongoose.model("productmodel", {
    name: String,
    description: String,
    price: Number,
    category: String,
}, "products")

app.get("/products", (req, res) => {
    ProductModel.find().then((data) => {
        res.json(data);
    }).catch((err) => {
        console.log(err);
        res.json({ message: "Error" });
    })

})

app.get("/product/:id", async (req, res) => {
    try {
        const product = await ProductModel.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ message: "Product not found" });
        }
        res.json(product);
    } catch (error) {
        res.status(500).json({ message: "Error fetching product details", error: error.message });
    }
});

app.post("/add/:id", authenticate, async (req, res) => {

    const productId = req.params.id;

    let user = await UserModel.findOne({
        mail: req.user.email
    });

    if (!user) {
        user = new UserModel({
            mail: req.user.email,
            name: req.user.name || "User",
            cart: [],
            orders: []
        });
    }

    user.cart.push(productId);

    await user.save();

    res.json({
        message: "Product added to cart",
        count: user.cart.length
    });
});

app.get("/cart/count", authenticate, async (req, res) => {

    const user = await UserModel.findOne({
        mail: req.user.email
    });

    res.json({
        count: user && user.cart ? user.cart.length : 0
    });
});


app.get("/cart", authenticate, async (req, res) => {
    try {
        const user = await UserModel.findOne({
            mail: req.user.email
        });

        if (!user || !user.cart || user.cart.length === 0) {
            return res.json([]);
        }

        // Count occurrences of each product ID in user's cart array
        const counts = {};
        user.cart.forEach((id) => {
            if (id) {
                const idStr = id.toString();
                counts[idStr] = (counts[idStr] || 0) + 1;
            }
        });

        const productIds = Object.keys(counts).filter((id) =>
            mongoose.Types.ObjectId.isValid(id)
        );

        if (productIds.length === 0) {
            return res.json([]);
        }

        const products = await ProductModel.find({ _id: { $in: productIds } });

        // Merge product details with quantity
        const cartItems = products.map((prod) => {
            const prodObj = prod.toObject();
            return {
                ...prodObj,
                quantity: counts[prod._id.toString()] || 1
            };
        });

        res.json(cartItems);
    } catch (error) {
        console.error("Cart endpoint error:", error);
        res.status(500).json({ message: "Error fetching cart items", error: error.message });
    }
});

// Increase quantity of a product in cart
app.post("/cart/increase/:id", authenticate, async (req, res) => {
    try {
        const productId = req.params.id;
        const user = await UserModel.findOne({ mail: req.user.email });

        if (!user) return res.status(404).json({ message: "User not found" });

        user.cart.push(productId);
        await user.save();

        res.json({ message: "Quantity increased", count: user.cart.length });
    } catch (error) {
        res.status(500).json({ message: "Error increasing quantity", error: error.message });
    }
});

// Decrease quantity of a product in cart
app.post("/cart/decrease/:id", authenticate, async (req, res) => {
    try {
        const productId = req.params.id;
        const user = await UserModel.findOne({ mail: req.user.email });

        if (!user) return res.status(404).json({ message: "User not found" });

        const index = user.cart.indexOf(productId);
        if (index > -1) {
            user.cart.splice(index, 1);
            await user.save();
        }

        res.json({ message: "Quantity decreased", count: user.cart.length });
    } catch (error) {
        res.status(500).json({ message: "Error decreasing quantity", error: error.message });
    }
});

// Remove item completely from cart
app.delete("/cart/remove/:id", authenticate, async (req, res) => {
    try {
        const productId = req.params.id;
        const user = await UserModel.findOne({ mail: req.user.email });

        if (!user) return res.status(404).json({ message: "User not found" });

        user.cart = user.cart.filter((id) => id.toString() !== productId);
        await user.save();

        res.json({ message: "Item removed from cart", count: user.cart.length });
    } catch (error) {
        res.status(500).json({ message: "Error removing item", error: error.message });
    }
});

// Create Razorpay Order
app.post("/create-order", authenticate, async (req, res) => {
    try {
        const { amount } = req.body;
        if (!amount || amount <= 0) {
            return res.status(400).json({ message: "Invalid amount" });
        }

        const options = {
            amount: Math.round(amount * 100), // amount in paise
            currency: "INR",
            receipt: `receipt_${Date.now()}`
        };

        const order = await razorpay.orders.create(options);
        res.json({
            id: order.id,
            currency: order.currency,
            amount: order.amount,
            key: process.env.RAZORPAY_API_KEY
        });
    } catch (error) {
        console.error("Razorpay order error:", error);
        res.status(500).json({ message: "Order creation failed", error: error.message });
    }
});

// Verify Razorpay Payment Signature and Save Order History
app.post("/verify-payment", authenticate, async (req, res) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            cartItems,
            totalAmount
        } = req.body;

        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac("sha256", process.env.RAZORPAY_API_SECRET)
            .update(body.toString())
            .digest("hex");

        if (expectedSignature === razorpay_signature) {
            const user = await UserModel.findOne({ mail: req.user.email });

            if (user) {
                const newOrder = {
                    orderId: razorpay_order_id,
                    paymentId: razorpay_payment_id,
                    amount: totalAmount,
                    items: cartItems || [],
                    date: new Date().toISOString(),
                    status: "SUCCESS"
                };

                user.orders = user.orders || [];
                user.orders.unshift(newOrder); // Add latest order at start
                user.cart = []; // Clear cart on success
                await user.save();
            }

            res.json({ message: "Payment verified successfully", success: true });
        } else {
            res.status(400).json({ message: "Invalid signature", success: false });
        }
    } catch (error) {
        res.status(500).json({ message: "Payment verification failed", error: error.message });
    }
});

// Get User Order History
app.get("/orders/history", authenticate, async (req, res) => {
    try {
        const user = await UserModel.findOne({ mail: req.user.email });
        if (!user) return res.status(404).json({ message: "User not found" });

        res.json(user.orders || []);
    } catch (error) {
        res.status(500).json({ message: "Error fetching order history", error: error.message });
    }
});




app.post("/register", async (req, res) => {
  try {
    const email = req.body.email;
    const name = req.body.name;

    const user = await UserModel.findOne({
      mail: email,
    });

    if (user) {
      return res.json({
        message: "User already exists",
        user: user,
      });
    }

    const newUser = new UserModel({
      mail: email,
      name: name,
      cart: [],
      orders: [],
    });

    await newUser.save();

    res.json({
      message: "User registered successfully",
      user: newUser,
    });
  } catch (error) {
    res.status(500).json({
      message: "Registration failed",
      error: error.message,
    });
  }
});


app.listen(PORT, () => {
    console.log(`Server Started on port ${PORT}`);
});
