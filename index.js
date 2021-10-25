const express = require("express");
const app = express();
const multer = require("multer");
const cors = require("cors");
const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const xlsx = require("xlsx");
const argon2 = require("argon2");

app.use(cors());

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
const UserSchema = new Schema(
  {
    username: { type: String, unique: true },
    password: { type: String },
    balance: { type: Number, default: 0 },
  },
  { versionKey: false }
);
UserSchema.pre("save", async function (next) {
  const user = this;

  if (!user.isModified("password")) return next();
  console.log(this);
  try {
    user.password = await argon2.hash(user.password);
    next();
  } catch (error) {
    next(error);
  }
});

const User = mongoose.model("users", UserSchema);

const TransactionSchema = new Schema(
  {
    userId: { type: mongoose.Types.ObjectId, ref: "users" },
    money: { type: Number, default: 0, required: true },
    type: { type: String, enum: ["withdraw", "deposit"] },
  },
  { versionKey: false }
);

TransactionSchema.post("save", async function (error, doc, next) {
  if(error){
    next(error)
  }
  try {
    if (doc.type === "withdraw") {
      User.findById(doc.userId, (err, user) => {
        if(err){
          next(err)
        }
        if (user.balance < doc.money) {
          next(new Error("Cannot withdraw with money greater than balance"));
        }
        user.balance = user.balance - doc.money;
        user.save();
        next();
      });
    } else if (doc.type === "deposit") {
      User.findById(doc.userId, (err, user) => {
        if(err){
          next(err)
        }
        user.balance = user.balance + doc.money;
        user.save();
        next();
      });
    }
  } catch (error2) {
    next(error2);
  }
});
const Transaction = mongoose.model("transactions", TransactionSchema);

const connectAndRetry = async () => {
  try {
    await mongoose.connect(
      "mongodb://test:test@localhost:27017/test?authSource=admin"
    );
    console.log("Connected");
  } catch (error) {
    console.log("Connecting in 5000ms .....");
    setTimeout(connectAndRetry, 5000);
  }
};

connectAndRetry();

const excelFilter = (req, file, cb) => {
  if (
    file.mimetype.includes("excel") ||
    file.mimetype.includes("spreadsheetml")
  ) {
    cb(null, true);
  } else {
    cb("Please upload only excel file.", false);
  }
};

const storage = multer.memoryStorage();

const upload = multer({ storage, fileFilter: excelFilter });

app.post("/upload/store", (req, res) => {
  upload.single("file")(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      // A Multer error occurred when uploading.
      return res
        .status(500)
        .send({ err, message: "Multer error occurred when uploading" });
    } else if (err) {
      // An unknown error occurred when uploading.
      return res.status(500).send(err);
    }

    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    let users = [];
    let user = {};
    console.log(workbook);
    for (let cell in worksheet) {
      const cellAsString = cell.toString();
      console.log(cellAsString);

      if (cellAsString[0] === "A") {
        user.username = worksheet[cell].v;
      }
      if (cellAsString[0] === "B") {
        user.password = worksheet[cell].v;
      }
      if (cellAsString[0] === "C") {
        user.age = worksheet[cell].v;
        users.push(user);
        user = {};
      }
    }

    if (!users) {
      res
        .status(500)
        .json({ message: "Data is not valid, Please check it again" });
    }
    /// remove header
    users.shift();
    console.log(users);

    User.insertMany(users, (err, value) => {
      if (err) {
        res.status(500).json({
          success: false,
          message: "Data is not valid, Please check it again",
          err,
        });
      }

      return res.status(200).send({ message: "Uploaded", users: value });
    });
  });
});

app.get("/", (req, res) => {
  res.send("Hello adu vip qua");
});

app.get("/download", (req, res) => {
  const workBook = xlsx.utils.book_new();
  User.find()
    .then((data) => {
      const dataToWrite = data.map((user) => [
        user.username,
        user.password,
        user.age,
      ]);
      const workSheetName = "Users";
      const workSheetColumnNames = ["username", "password", "age"];
      const workSheetData = [workSheetColumnNames, ...dataToWrite];
      const workSheet = xlsx.utils.aoa_to_sheet(workSheetData);
      xlsx.utils.book_append_sheet(workBook, workSheet, workSheetName);

      const buffer = xlsx.write(workBook, { type: "buffer" });
      // console.log(buffer);
      res.write(buffer);
      res.end();
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({
        success: false,
        message: "Data is not valid, Please check it again",
        err,
      });
    });
});

app.get("/users", async (req, res) => {
  try {
    return res.json({ success: true, users: await User.find() });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
      error,
    });
  }
});

app.post("/users", async (req, res) => {
  const { username, password } = req.body;
  const user = new User({ username, password });
  try {
    await user.save();
    return res.status(201).send({ success: true, message: "saved", user });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
      error,
    });
  }
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ username });
    if (!(await argon2.verify(user.password, password))) {
      return res
        .status(400)
        .json({ success: false, message: "password is not correct" });
    } else {
      return res.json({ success: true, message: "login" });
    }
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Data is not valid, Please check it again",
      err,
    });
  }
});

app.patch("/password", (req, res) => {
  User.findOne({ username: req.body.username }, async (err, user) => {
    if (err) {
      console.log(err);
      return res.status(500).json({
        success: false,
        message: "Data is not valid, Please check it again",
        err,
      });
    } else {
      user.password = req.body.newPassword;
      user.save((err, data) => {
        if (err) {
          console.log(err);
          return res.status(500).json({
            success: false,
            message: "Data is not valid, Please check it again",
            err,
          });
        }
        res.send(data);
      });
    }
  });
});

app.post("/transact", (req, res) => {
  const { userId, money, type } = req.body;
  new Transaction({ userId, money, type }).save((err, transaction) => {
    if(err){
      return res.status(500).json({
        success: false,
        message: err.message || "Internal Server Error",
        error: err,
      })
    }else{
      return res.status(201).json({success: true, transaction})
    }
  });
});
app.listen(4000);