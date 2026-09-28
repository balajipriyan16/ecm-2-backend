import { firebaseAuth } from "./firebaseAdmin.js";

async function authenticate(req, res, next) {

    try {

        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({
                message: "Authorization token missing"
            });
        }

        const idToken = authHeader.split(" ")[1];

        const decodedToken = await firebaseAuth.verifyIdToken(idToken);

        req.user = decodedToken;

        next();

    } catch (error) {

        console.log(error);

        return res.status(401).json({
            message: "Invalid or expired token"
        });

    }
}

export default authenticate;