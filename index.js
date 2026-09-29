import "dotenv/config";

import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import crypto from "crypto";
import Razorpay from "razorpay";
import path from "path";

import authenticate from "./authMiddleware.js";

const app = express();


// =======================================================
// MIDDLEWARE
// =======================================================

app.use(cors());
app.use(express.json());

const imagesPath = path.resolve("images");

app.use("/images", express.static(imagesPath));
app.use("/image", express.static(imagesPath));


// =======================================================
// ENV
// =======================================================

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    throw new Error("MONGODB_URI is not defined");
}


// =======================================================
// MONGODB CONNECTION
// Optimized for Vercel / Serverless
// =======================================================

const cached = globalThis.mongooseCache || {
    conn: null,
    promise: null,
};

globalThis.mongooseCache = cached;


async function connectDB() {

    // Already connected
    if (cached.conn) {
        return cached.conn;
    }

    // Prevent multiple simultaneous connections
    if (!cached.promise) {

        cached.promise = mongoose.connect(MONGODB_URI, {

            serverSelectionTimeoutMS: 5000,

            maxPoolSize: 10,

            minPoolSize: 0,

        })
        .then((mongooseInstance) => {

            console.log("MongoDB Connected");

            return mongooseInstance;

        });
    }

    try {

        cached.conn = await cached.promise;

        return cached.conn;

    } catch (error) {

        cached.promise = null;

        console.error("MongoDB Connection Error:", error);

        throw error;
    }
}


// =======================================================
// RAZORPAY
// =======================================================

const razorpay = new Razorpay({

    key_id: process.env.RAZORPAY_API_KEY,

    key_secret: process.env.RAZORPAY_API_SECRET,

});


// =======================================================
// SCHEMAS
// =======================================================

const userSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            trim: true,
        },

        mail: {
            type: String,
            required: true,
            unique: true,
            index: true,
            lowercase: true,
            trim: true,
        },

        cart: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "productmodel",
            },
        ],

        orders: [
            {
                orderId: String,

                paymentId: String,

                amount: Number,

                items: Array,

                date: {
                    type: Date,
                    default: Date.now,
                },

                status: {
                    type: String,
                    default: "SUCCESS",
                },
            },
        ],
    },
    {
        versionKey: false,
    }
);


const productSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },

        description: String,

        price: {
            type: Number,
            required: true,
        },

        category: {
            type: String,
            index: true,
        },
    },
    {
        versionKey: false,
    }
);


// Prevent model overwrite issues on Vercel
const UserModel =
    mongoose.models.usermodel ||
    mongoose.model(
        "usermodel",
        userSchema,
        "users"
    );


const ProductModel =
    mongoose.models.productmodel ||
    mongoose.model(
        "productmodel",
        productSchema,
        "products"
    );


// =======================================================
// BASIC ROUTE
// =======================================================

app.get("/", (req, res) => {

    res.json({
        message: "MyKart API Running",
    });

});


// =======================================================
// PRODUCTS
// =======================================================

app.get("/products", async (req, res, next) => {

    try {

        await connectDB();

        const products = await ProductModel
            .find()
            .lean();

        res.json(products);

    } catch (error) {

        next(error);

    }

});


// =======================================================
// SINGLE PRODUCT
// =======================================================

app.get("/product/:id", async (req, res, next) => {

    try {

        await connectDB();

        const { id } = req.params;


        if (!mongoose.Types.ObjectId.isValid(id)) {

            return res.status(400).json({
                message: "Invalid product ID",
            });

        }


        const product = await ProductModel
            .findById(id)
            .lean();


        if (!product) {

            return res.status(404).json({
                message: "Product not found",
            });

        }


        res.json(product);

    } catch (error) {

        next(error);

    }

});


// =======================================================
// REGISTER USER
// =======================================================

app.post("/register", async (req, res, next) => {

    try {

        await connectDB();

        const { email, name } = req.body;


        if (!email) {

            return res.status(400).json({
                message: "Email required",
            });

        }


        const normalizedEmail = email
            .toLowerCase()
            .trim();


        // Avoid findOne + create
        // upsert handles both cases efficiently

        const user = await UserModel.findOneAndUpdate(

            {
                mail: normalizedEmail,
            },

            {
                $setOnInsert: {
                    mail: normalizedEmail,
                    name: name || "User",
                    cart: [],
                    orders: [],
                },
            },

            {
                new: true,
                upsert: true,
            }

        ).lean();


        res.json({
            message: "User registered successfully",
            user,
        });

    } catch (error) {

        next(error);

    }

});


// =======================================================
// GET USER
// =======================================================

app.get(
    "/user",
    authenticate,
    async (req, res, next) => {

        try {

            await connectDB();


            const user = await UserModel
                .findOne({
                    mail: req.user.email.toLowerCase(),
                })
                .lean();


            res.json(user || null);

        } catch (error) {

            next(error);

        }

    }
);


// =======================================================
// ADD TO CART
// =======================================================

app.post(
    "/add/:id",
    authenticate,
    async (req, res, next) => {

        try {

            await connectDB();


            const { id } = req.params;


            if (!mongoose.Types.ObjectId.isValid(id)) {

                return res.status(400).json({
                    message: "Invalid product ID",
                });

            }


            const user = await UserModel.findOneAndUpdate(

                {
                    mail: req.user.email.toLowerCase(),
                },

                {
                    $push: {
                        cart: id,
                    },

                    $setOnInsert: {
                        name: req.user.name || "User",
                    },
                },

                {
                    new: true,
                    upsert: true,
                }

            )
            .select("cart")
            .lean();


            res.json({

                message: "Product added to cart",

                count: user.cart.length,

            });

        } catch (error) {

            next(error);

        }

    }
);


// =======================================================
// CART COUNT
// =======================================================

app.get(
    "/cart/count",
    authenticate,
    async (req, res, next) => {

        try {

            await connectDB();


            const user = await UserModel
                .findOne({
                    mail: req.user.email.toLowerCase(),
                })
                .select("cart")
                .lean();


            res.json({

                count: user?.cart?.length || 0,

            });

        } catch (error) {

            next(error);

        }

    }
);


// =======================================================
// GET CART
// =======================================================

app.get(
    "/cart",
    authenticate,
    async (req, res, next) => {

        try {

            await connectDB();


            const user = await UserModel
                .findOne({
                    mail: req.user.email.toLowerCase(),
                })
                .select("cart")
                .lean();


            if (!user?.cart?.length) {

                return res.json([]);

            }


            // Count quantity
            const counts = {};

            for (const id of user.cart) {

                const idString = id.toString();

                counts[idString] =
                    (counts[idString] || 0) + 1;

            }


            const productIds =
                Object.keys(counts);


            const products = await ProductModel
                .find({
                    _id: {
                        $in: productIds,
                    },
                })
                .lean();


            const cartItems = products.map(
                (product) => ({

                    ...product,

                    quantity:
                        counts[
                            product._id.toString()
                        ] || 1,

                })
            );


            res.json(cartItems);

        } catch (error) {

            next(error);

        }

    }
);


// =======================================================
// INCREASE CART QUANTITY
// =======================================================

app.post(
    "/cart/increase/:id",
    authenticate,
    async (req, res, next) => {

        try {

            await connectDB();


            const { id } = req.params;


            if (!mongoose.Types.ObjectId.isValid(id)) {

                return res.status(400).json({
                    message: "Invalid product ID",
                });

            }


            const user = await UserModel.findOneAndUpdate(

                {
                    mail: req.user.email.toLowerCase(),
                },

                {
                    $push: {
                        cart: id,
                    },
                },

                {
                    new: true,
                }

            )
            .select("cart")
            .lean();


            if (!user) {

                return res.status(404).json({
                    message: "User not found",
                });

            }


            res.json({

                message: "Quantity increased",

                count: user.cart.length,

            });

        } catch (error) {

            next(error);

        }

    }
);


// =======================================================
// DECREASE CART QUANTITY
// Removes only ONE occurrence
// =======================================================

app.post(
    "/cart/decrease/:id",
    authenticate,
    async (req, res, next) => {

        try {

            await connectDB();


            const { id } = req.params;


            const user = await UserModel.findOne({

                mail: req.user.email.toLowerCase(),

            });


            if (!user) {

                return res.status(404).json({
                    message: "User not found",
                });

            }


            const index = user.cart.findIndex(

                (productId) =>
                    productId.toString() === id

            );


            if (index !== -1) {

                user.cart.splice(index, 1);

                await user.save();

            }


            res.json({

                message: "Quantity decreased",

                count: user.cart.length,

            });

        } catch (error) {

            next(error);

        }

    }
);


// =======================================================
// REMOVE PRODUCT COMPLETELY FROM CART
// =======================================================

app.delete(
    "/cart/remove/:id",
    authenticate,
    async (req, res, next) => {

        try {

            await connectDB();


            const { id } = req.params;


            const user = await UserModel.findOneAndUpdate(

                {
                    mail: req.user.email.toLowerCase(),
                },

                {
                    $pull: {
                        cart: id,
                    },
                },

                {
                    new: true,
                }

            )
            .select("cart")
            .lean();


            if (!user) {

                return res.status(404).json({
                    message: "User not found",
                });

            }


            res.json({

                message: "Item removed from cart",

                count: user.cart.length,

            });

        } catch (error) {

            next(error);

        }

    }
);


// =======================================================
// CREATE RAZORPAY ORDER
// =======================================================

app.post(
    "/create-order",
    authenticate,
    async (req, res, next) => {

        try {

            const { amount } = req.body;


            if (!amount || amount <= 0) {

                return res.status(400).json({
                    message: "Invalid amount",
                });

            }


            const order =
                await razorpay.orders.create({

                    amount: Math.round(
                        Number(amount) * 100
                    ),

                    currency: "INR",

                    receipt:
                        `receipt_${Date.now()}`,

                });


            res.json({

                id: order.id,

                currency: order.currency,

                amount: order.amount,

                key:
                    process.env
                        .RAZORPAY_API_KEY,

            });

        } catch (error) {

            next(error);

        }

    }
);


// =======================================================
// VERIFY PAYMENT
// =======================================================

app.post(
    "/verify-payment",
    authenticate,
    async (req, res, next) => {

        try {

            await connectDB();


            const {

                razorpay_order_id,

                razorpay_payment_id,

                razorpay_signature,

                cartItems,

                totalAmount,

            } = req.body;


            const body =
                `${razorpay_order_id}|${razorpay_payment_id}`;


            const expectedSignature =
                crypto
                    .createHmac(
                        "sha256",
                        process.env
                            .RAZORPAY_API_SECRET
                    )
                    .update(body)
                    .digest("hex");


            if (
                expectedSignature !==
                razorpay_signature
            ) {

                return res.status(400).json({

                    message:
                        "Invalid payment signature",

                    success: false,

                });

            }


            const newOrder = {

                orderId:
                    razorpay_order_id,

                paymentId:
                    razorpay_payment_id,

                amount:
                    Number(totalAmount),

                items:
                    cartItems || [],

                date:
                    new Date(),

                status:
                    "SUCCESS",

            };


            // Save order + clear cart
            // using one database operation

            const user =
                await UserModel.findOneAndUpdate(

                    {
                        mail:
                            req.user.email
                                .toLowerCase(),
                    },

                    {
                        $push: {
                            orders: {
                                $each: [newOrder],
                                $position: 0,
                            },
                        },

                        $set: {
                            cart: [],
                        },
                    },

                    {
                        new: true,
                    }

                );


            if (!user) {

                return res.status(404).json({
                    message: "User not found",
                });

            }


            res.json({

                message:
                    "Payment verified successfully",

                success: true,

            });

        } catch (error) {

            next(error);

        }

    }
);


// =======================================================
// ORDER HISTORY
// =======================================================

app.get(
    "/orders/history",
    authenticate,
    async (req, res, next) => {

        try {

            await connectDB();


            const user = await UserModel
                .findOne({
                    mail:
                        req.user.email
                            .toLowerCase(),
                })
                .select("orders")
                .lean();


            if (!user) {

                return res.status(404).json({
                    message: "User not found",
                });

            }


            res.json(user.orders || []);

        } catch (error) {

            next(error);

        }

    }
);


// =======================================================
// 404
// =======================================================

app.use((req, res) => {

    res.status(404).json({

        message: "Route not found",

    });

});


// =======================================================
// GLOBAL ERROR HANDLER
// =======================================================

app.use((error, req, res, next) => {

    console.error(
        `${req.method} ${req.path}`,
        error
    );


    res.status(
        error.status || 500
    ).json({

        message:
            error.message ||
            "Internal server error",

    });

});


// =======================================================
// LOCAL SERVER
// =======================================================

if (
    process.env.NODE_ENV !== "production" &&
    !process.env.VERCEL
) {

    app.listen(PORT, () => {

        console.log(
            `Server running on port ${PORT}`
        );

    });

}


// =======================================================
// VERCEL EXPORT
// =======================================================

export default app;