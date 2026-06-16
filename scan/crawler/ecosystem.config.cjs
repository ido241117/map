module.exports = {
  apps: [
    {
      name: "hcm-land-crawl",
      script: "d:\\Project C\\map\\scan\\crawler\\crawl_hcm_land.py",
      interpreter: "C:\\Users\\ADMIN\\AppData\\Local\\Programs\\Python\\Python313\\python.exe",
      cwd: "d:\\Project C\\map\\scan\\crawler",
      args: "--only-missing",
      autorestart: false,
      output: "d:\\Project C\\map\\scan\\crawler\\data\\crawl-out.log",
      error: "d:\\Project C\\map\\scan\\crawler\\data\\crawl-err.log",
      env: {
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
      },
    },
  ],
};
