import express, { Request, Response } from "express";
import bodyParser from "body-parser";
import { TokenRegistry } from "./routes/index.js";

const app = express();
const port = 3000;

// Middleware
app.use(bodyParser.json());


const tokenRegisry = new TokenRegistry('./registry');
// Routes
app.get("/", (req: Request, res: Response) => {
  res.send("Hello, world!");
});

app.get("/tokens", (req: Request, res: Response) => {
    const chains: string[] | null = req.query.chains ? req.query.chains.toString().split(',') : null;
    const tokens = tokenRegisry.getAllTokens(chains);
    const response: Record<string, any> = Object.fromEntries(tokens.entries());
    res.json({
        tokens: response
    });
});

app.get("/token", (req: Request, res: Response) => {
    const chain = req.query.chain as string;    
    const token = req.query.token as string;
    if (!chain || !token) {
        res.status(400).send('Missing chain or token parameter');
        return;
    }
    const tokenData = tokenRegisry.getToken(token, chain);
    return res.json(tokenData);
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});