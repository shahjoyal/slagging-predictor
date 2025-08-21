const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const xlsx = require('xlsx'); 
const multer = require("multer");
const mongoose = require("mongoose");
const fs = require("fs");
const ExcelJS = require('exceljs');

const app = express();

require('dotenv').config();
console.log("MongoDB URI:", process.env.MONGODB_URI);

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static('js'));


app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'slagging_coal_page.html'));
});



app.get("/get_coal_types", async (req, res) => {
  try {
      const requiredProperties = [
          "SiO₂", "Al₂O₃", "Fe₂O₃", "CaO", "MgO", "Na₂O", "K₂O", "TiO₂", 
          "SO₃", "P₂O₅", "Mn₃O₄", "Sulphur (S)", "GCV"
      ];

      // Fetch data from MongoDB, excluding _id and __v
      const dbData = await SlaggingData.find({}, { __v: 0 });

      // Format data to match the Excel-based response structure
      const coalData = dbData.map(row => {
          return {
              id: row._id.toString(),
              coalType: row["Coal source name"], 
              transportId : row["Transport ID"] || null, // Ensure transportId is present
              properties: requiredProperties.reduce((props, prop) => {
                  props[prop] = row[prop] || null; // Ensure missing values don't break the response
                  return props;
              }, {})
          };
      });

      res.json({ coal_data: coalData });
  } catch (error) {
      console.error("Error fetching coal types from MongoDB:", error);
      res.status(500).json({ error: "Failed to fetch coal types" });
  }
});



// Use Multer with memory storage (No local file saving)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

/// Route to download Excel template
app.get("/download-template", async (req, res) => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Slagging Data");

    // Adding instructions in a single row
    const instructionText = `Instruction for filling the sheet:
1. Column A - Enter the coal mine source name (For example: Adaro, WCL-Wani etc.)
2. Column B - Enter the name of Unit from which data is uploaded. (For example - BTPS, STPP, MNTPS)
3. Column C - Enter the date of upload for sample.
4. Column D - Enter type of transport - Road/ Railway/ Ropeway/ Pipe conveyor/ Ships etc.
5. Column E to Column T - Enter the elemental analysis of Ash in coal.
6. Ensure that the elemental values entered are obtained using a single type of analysis. (Either using Oxidation method or Reduction method)  
7. Date format should be YYYY-MM-DD. `;

    // Merging cells for the instruction and applying styles
    worksheet.mergeCells('A1:T1');
    const instructionCell = worksheet.getCell('A1');
    instructionCell.value = instructionText;
    instructionCell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
    instructionCell.font = { bold: true };
    instructionCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEFEFEF' }
    };

    worksheet.getRow(1).height = 120;

    const logoPath = path.resolve(__dirname,'public', 'images', './abhitech-logo.png');
    const logoImageId = workbook.addImage({
        filename: logoPath,
        extension: 'png'
    });

    worksheet.addImage(logoImageId, {
        tl: { col: 20, row: 0 },
        br: { col: 22, row: 1 },
    });

    // Adding the Elemental Analysis Header
    worksheet.mergeCells('A2:W2');
    const analysisHeaderCell = worksheet.getCell('A2');
    analysisHeaderCell.value = 'Elemental Analysis of Ash in coal';
    analysisHeaderCell.alignment = { vertical: 'middle', horizontal: 'center' };
    analysisHeaderCell.font = { bold: true, size: 12 };

    // Add the table headers
    const headers = [
        "Coal source name","Transport ID", "Data uploaded by TPS", "Shipment date", "Type of transport",
        "SiO₂", "Al₂O₃", "Fe₂O₃", "CaO", "MgO", "Na₂O", "K₂O", "TiO₂", "SO₃", "P₂O₅",
        "Mn₃O₄", "Sulphur (S)", "GCV"
    ];
    worksheet.addRow(headers);

    // Style the header
    const headerRow = worksheet.getRow(3);
    headerRow.font = { bold: true };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow.eachCell((cell) => {
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFB0E0E6' }
        };
        cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
        };
    });

    // Set column width
    headers.forEach((_, index) => {
        worksheet.getColumn(index + 1).width = 20;
    });

    // Send the Excel file
    res.setHeader("Content-Disposition", "attachment; filename=Slagging_Data_Template.xlsx");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

    await workbook.xlsx.write(res);
    res.end();
});



// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, { 
  serverSelectionTimeoutMS: 30000 // Increase timeout to 30 seconds
})
.then(() => console.log("MongoDB connected successfully"))
.catch(err => console.error("MongoDB connection error:", err));

// Define Mongoose Schema (Flexible to accept any structure)
const slaggingSchema = new mongoose.Schema({}, { strict: false });
const SlaggingData = mongoose.model("SlaggingData", slaggingSchema);

function excelSerialToDate(serial) {
    const excelEpoch = new Date(Date.UTC(1900, 0, 1)); // Excel epoch (Jan 1, 1900)
    const daysOffset = serial - 1; // Excel starts with 1, not 0
    const date = new Date(excelEpoch.getTime() + daysOffset * 24 * 60 * 60 * 1000);
    return date.toISOString().split('T')[0];
  }
  

// Route to handle Excel file upload & save to MongoDB
app.post("/upload-excel", upload.single("file"), async (req, res) => { 
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  
    try {
      const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      
      const jsonData = xlsx.utils.sheet_to_json(sheet, { range: 2 });
  
      const cleanedData = jsonData.map(row => {
      Object.keys(row).forEach(key => {
        const value = row[key];

        if (key === 'Upload date' && typeof value === "number" && value > 0 && value < 2958465) {
          row[key] = excelSerialToDate(value); // Convert Excel date
        } else if (!isNaN(value) && value !== "" && value !== null) {
          const num = parseFloat(value);
          row[key] = Math.round(num * 100) / 100; // Round to 2 decimal places
        }
      });
      return row;
    });
  
      await SlaggingData.insertMany(cleanedData);
  
      res.json({ message: "Data uploaded successfully", data: cleanedData });
    } catch (error) {
      console.error("Error processing file:", error);
      res.status(500).json({ error: "Failed to process file" });
    }
  });
  
  



// Route to fetch data from MongoDB
app.get("/fetch-data", async (req, res) => {
  try {
      const data = await SlaggingData.find({}, { __v: 0 }); // Exclude _id and __v
      res.json(data);
  } catch (error) {
      console.error("Error fetching data:", error);
      res.status(500).json({ error: "Failed to fetch data" });
  }
}); 

app.delete("/delete-data", async (req, res) => {
  try {
    const { ids } = req.body;
    const result = await SlaggingData.deleteMany({ _id: { $in: ids } });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "No data found" });
    }

    res.json({ message: `${result.deletedCount} data deleted successfully` });
  } catch (error) {
    console.error("Error deleting data:", error);
    res.status(500).json({ error: "Failed to delete data" });
  }
  });




function calculateAFT(values) {
    const [SiO2, Al2O3, Fe2O3, CaO, MgO, Na2O, K2O, SO3, TiO2] = values;
    const sumSiAl = SiO2 + Al2O3;

    if (sumSiAl < 55) {
        return (
            1245 +
            1.1 * SiO2 +
            0.95 * Al2O3 -
            2.5 * Fe2O3 -
            2.98 * CaO -
            4.5 * MgO -
            7.89 * (Na2O + K2O) -
            1.7 * SO3 -
            0.63 * TiO2
        );
    } else if (sumSiAl >= 55 && sumSiAl < 75) {
        return (
            1323 +
            1.45 * SiO2 +
            0.683 * Al2O3 -
            2.39 * Fe2O3 -
            3.1 * CaO -
            4.5 * MgO -
            7.49 * (Na2O + K2O) -
            2.1 * SO3 -
            0.63 * TiO2
        );
    } else {
        return (
            1395 +
            1.2 * SiO2 +
            0.9 * Al2O3 -
            2.5 * Fe2O3 -
            3.1 * CaO -
            4.5 * MgO -
            7.2 * (Na2O + K2O) -
            1.7 * SO3 -
            0.63 * TiO2
        );
    }
    
}
// Generate all valid blends summing to 100
function* generateCombinations(bounds, step) {
    function* helper(index, combo) {
        if (index === bounds.length) {
            const sum = combo.reduce((a, b) => a + b, 0);
            if (sum === 100) yield combo;
            return;
        }

        const [min, max] = bounds[index];
        for (let i = min; i <= max; i += step) {
            yield* helper(index + 1, [...combo, i]);
        }
    }
    yield* helper(0, []);
}

app.post("/optimize", async (req, res) => {
    try {
        const { blends } = req.body;

        if (!blends || !Array.isArray(blends) || blends.length === 0) {
            return res.status(400).json({ error: "Invalid blend data" });

        }

        const oxideCols = ['SiO2', 'Al2O3', 'Fe2O3', 'CaO', 'MgO', 'Na2O', 'K2O', 'SO3', 'TiO2'];
        const coalNames = blends.map(b => b.coal);
        const oxideValues = blends.map(b => oxideCols.map(col => b.properties[col] || 0));
        const minMaxBounds = blends.map(b => [b.min, b.max]);
        const costsPerTon = blends.map(b => b.cost);
        const gcvValue = blends.map(b => b.properties.Gcv);

       const individualCoalAFTs = oxideValues.map((vals, i) => ({
            coal: coalNames[i],               // name we stored earlier
            predicted_aft: calculateAFT(vals) // AFT from the 9 oxides
            }));

        const step = 1;
        const validBlends = [];
        for (const blend of generateCombinations(minMaxBounds, step)) {
            const weights = blend.map(x => x / 100);
            const blendedOxides = oxideCols.map((_, i) =>
                oxideValues.reduce((sum, val, idx) => sum + val[i] * weights[idx], 0)
            );
            const predictedAFT = calculateAFT(blendedOxides);
            const totalgcv = blend.reduce((sum, pct, i ) => sum + pct*gcvValue[i], 0) / 100;    
            const totalCost = blend.reduce((sum, pct, i) => sum + pct * costsPerTon[i], 0) / 100;

            validBlends.push({
                blend,
                predicted_aft: predictedAFT,
                cost: totalCost,
                gcv: totalgcv,
                blended_oxides: blendedOxides
            });
        }

        if (validBlends.length === 0) {
            return res.status(404).json({ message: "No valid blends found" });
        }

        const aftVals = validBlends.map(b => b.predicted_aft);
        const costVals = validBlends.map(b => b.cost);
        const aftMin = Math.min(...aftVals);
        const aftMax = Math.max(...aftVals);
        const costMin = Math.min(...costVals);
        const costMax = Math.max(...costVals);

        const blendScores = validBlends.map((b, i) => {
            const aftNorm = (b.predicted_aft - aftMin) / (aftMax - aftMin);
            const costNorm = (costMax - b.cost) / (costMax - costMin);
            return aftNorm + costNorm;
        });

        const bestAftBlend = validBlends[aftVals.indexOf(Math.max(...aftVals))];
        const cheapestBlend = validBlends[costVals.indexOf(Math.min(...costVals))];
        const balancedBlend = validBlends[blendScores.indexOf(Math.max(...blendScores))];

       

        const currentWeights = blends.map(b => b.current / 100);
        const currentBlendedOxides = oxideCols.map((_, i) =>
            oxideValues.reduce((sum, val, idx) => sum + val[i] * currentWeights[idx], 0)
        );
        const currentAFT = calculateAFT(currentBlendedOxides);
        const currentGCV = blends.reduce((sum, b, i) => sum + (b.current * gcvValue[i]), 0) / 100;
        const currentCost = blends.reduce((sum, b, i) => sum + (b.current * costsPerTon[i]), 0) / 100;

        const currentBlend = {
            blend: blends.map(b => b.current),
            predicted_aft: currentAFT,
            gcv: currentGCV,
            cost: currentCost
        };


        res.json({
            best_aft_blend: bestAftBlend,
            cheapest_blend: cheapestBlend,
            balanced_blend: balancedBlend,
            current_blend:currentBlend ,
            individual_coal_afts: individualCoalAFTs  
        });

    } catch (err) {
        console.error("Optimization error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Start Server
module.exports = app;