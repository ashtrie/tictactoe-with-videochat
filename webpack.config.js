var webpack = require('webpack');
process.env.NODE_ENV = 'production';

module.exports = {
    entry: './src/client.js',
    output: {
        path: './public',
        filename: 'bundle.js'
    },
    module: {
        loaders: [
            {
                test: /\.js$/,
                exclude: /node_modules/,
                loader: 'babel-loader'
            }
        ]
    },
    // plugins: [
    //     new webpack.optimize.UglifyJsPlugin({ minimize: true })
    // ],
    resolve: {
        extensions: ['', '.js', '.json']
    }
};
